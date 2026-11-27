#!/usr/bin/env bash
# Compile une app Android dans Ubuntu 24.04 (WSL), avec les mêmes outils que
# sa CI GitHub (runner ubuntu-24.04). Le kit le lance en root :
#   wsl.exe --distribution Ubuntu-24.04 --user root --exec bash -s
# avec ce fichier sur l'entrée standard. Chaque étape ne refait que ce qui
# manque : seule la première compilation installe les outils.
#
# Paramètres, transmis par le kit (WSLENV) :
#   HK_DEPOT      adresse https du dépôt (public)
#   HK_NOM        dossier de travail : /root/hey-kit/<HK_NOM>
#   HK_SORTIE     dossier Windows des APK (déjà traduit en /mnt/<lecteur>/…)
#   HK_TACHES     tâches Gradle, séparées par des espaces
#   HK_CIBLES     cibles Rust Android, séparées par des espaces
#   HK_NDK        version du NDK
#   HK_CARGO_NDK  version de cargo-ndk
# La signature (ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD,
# ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD) et les réglages de l'app sont lus
# par Gradle comme sur la CI. Le keystore n'est écrit qu'en mémoire
# (/dev/shm) et effacé à la fin, même en cas d'échec.
#
# Sortie lue par le kit : « ::etape <nom> », « ::version <x.y.z> »,
# « ::echec <code> » ; le reste est le journal.
set -euo pipefail

etape() { printf '::etape %s\n' "$1"; }
echec() {
  printf '::echec %s\n' "$1"
  exit 1
}

for parametre in HK_DEPOT HK_NOM HK_SORTIE HK_TACHES HK_CIBLES HK_NDK HK_CARGO_NDK ANDROID_KEYSTORE_BASE64; do
  [[ -n "${!parametre:-}" ]] || echec "parametre"
done

export DEBIAN_FRONTEND=noninteractive
sdk=/opt/android-sdk
# developer.android.com/studio, « Command line tools only », vérifié le 2026-11-27.
outils_zip="commandlinetools-linux-15859902_latest.zip"
outils_sha256="4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583"

etape paquets
paquets=(openjdk-17-jdk-headless unzip curl git ca-certificates build-essential)
manquants=()
for paquet in "${paquets[@]}"; do
  dpkg-query -W -f='${Status}' "$paquet" 2>/dev/null | grep -q "install ok installed" || manquants+=("$paquet")
done
if [[ ${#manquants[@]} -gt 0 ]]; then
  apt-get update -q || echec apt
  apt-get install -y -q --no-install-recommends "${manquants[@]}" || echec apt
fi
javac="$(readlink -f "$(command -v javac)")"
export JAVA_HOME="${javac%/bin/javac}"

etape sdk
sdkmanager="$sdk/cmdline-tools/latest/bin/sdkmanager"
if [[ ! -x "$sdkmanager" ]]; then
  temporaire="$(mktemp -d)"
  curl -fsSL --retry 3 -o "$temporaire/outils.zip" "https://dl.google.com/android/repository/$outils_zip" || echec telechargement
  printf '%s  %s\n' "$outils_sha256" "$temporaire/outils.zip" | sha256sum -c --quiet || echec empreinte
  unzip -q "$temporaire/outils.zip" -d "$temporaire"
  mkdir -p "$sdk/cmdline-tools"
  rm -rf "$sdk/cmdline-tools/latest"
  mv "$temporaire/cmdline-tools" "$sdk/cmdline-tools/latest"
  rm -rf "$temporaire"
fi
{ yes || true; } | "$sdkmanager" --sdk_root="$sdk" --licenses >/dev/null || echec licences
# Les build-tools manquants sont téléchargés par Gradle (licences acceptées).
"$sdkmanager" --sdk_root="$sdk" "platforms;android-36" "platform-tools" "ndk;$HK_NDK" || echec sdk

etape rust
if [[ ! -x "$HOME/.cargo/bin/rustup" ]]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain none --no-modify-path || echec rustup
fi
export PATH="$HOME/.cargo/bin:$PATH"

etape depot
travail="/root/hey-kit/$HK_NOM"
if [[ -d "$travail/.git" ]]; then
  git -C "$travail" fetch --quiet origin main || echec depot
  git -C "$travail" reset --quiet --hard FETCH_HEAD || echec depot
else
  mkdir -p /root/hey-kit
  git clone --quiet "$HK_DEPOT" "$travail" || echec depot
fi
cd "$travail"
git log -1 --format='Commit %h du %cs : %s'

# Même chaîne Rust que la CI (.github/actions/setup-rust) : canal de
# rust-toolchain.toml, cibles Android en plus.
canal="$(sed -n 's/^channel[[:space:]]*=[[:space:]]*"\(.*\)"/\1/p' rust-toolchain.toml)"
[[ -n "$canal" ]] || echec rust
arguments=(--profile minimal --component rustfmt --component clippy --no-self-update)
for cible in $HK_CIBLES; do
  arguments+=(--target "$cible")
done
rustup toolchain install "$canal" "${arguments[@]}" || echec rust
if [[ "$(cargo ndk --version 2>/dev/null || true)" != *"$HK_CARGO_NDK"* ]]; then
  cargo install cargo-ndk --version "$HK_CARGO_NDK" --locked || echec cargo-ndk
fi

etape compilation
version="$(sed -n '/^\[workspace\.package\]/,/^\[/s/^version[[:space:]]*=[[:space:]]*"\(.*\)"/\1/p' Cargo.toml | head -n 1)"
[[ -n "$version" ]] || version="inconnue"
printf '::version %s\n' "$version"

cle="$(mktemp /dev/shm/hey-kit-XXXXXX.jks)"
trap 'rm -f "$cle"' EXIT
printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode >"$cle" || echec keystore
unset ANDROID_KEYSTORE_BASE64
export ANDROID_KEYSTORE_PATH="$cle"
export ANDROID_HOME="$sdk" ANDROID_SDK_ROOT="$sdk" ANDROID_NDK_HOME="$sdk/ndk/$HK_NDK"
export CARGO_INCREMENTAL=0
read -r -a taches <<<"$HK_TACHES"
(cd android && ./gradlew "${taches[@]}" --no-daemon --console=plain --stacktrace) || echec gradle

etape copie
destination="$HK_SORTIE/$version"
mkdir -p "$destination" || echec copie
copies=0
while IFS= read -r -d '' apk; do
  cp -f "$apk" "$destination/" || echec copie
  printf 'APK : %s\n' "$(basename "$apk")"
  copies=$((copies + 1))
done < <(find android/app/build/outputs/apk -path '*/release/*.apk' -print0)
[[ "$copies" -gt 0 ]] || echec apk

etape fini
