// Plantages des apps, lus dans l'export BigQuery de Crashlytics.
//
// Crashlytics n'a pas d'API de lecture publiée : sa documentation passe par
// l'export vers BigQuery (dataset `firebase_crashlytics`, une table par app,
// nommée d'après le paquet). Le kit y lance une requête en lecture seule avec
// le compte de service Google du coffre, regroupe les plantages par problème,
// et en tire un rapport sans secret à copier dans une discussion.
import { DOSSIER_COMMUN, jetonGoogle, lireCompteGoogle } from "./connexions.mjs";
import { app as trouverApp } from "./apps.mjs";
import { ErreurCoffre } from "./coffre.mjs";

const DELAI = 45_000;
// Lecture seule : accepté par la méthode jobs.query de BigQuery.
const PORTEE = "https://www.googleapis.com/auth/cloud-platform.read-only";
// Garde-fou de coût : la requête échoue plutôt que de lire plus de 1 Go.
const OCTETS_MAX = String(1024 ** 3);
export const PERIODES = Object.freeze([1, 7, 30]);

// Une ligne par problème : nombre d'événements et d'appareils, première et
// dernière apparition, détail du plantage le plus récent.
function requete(projet, tables) {
  return `SELECT
  issue_id,
  COUNT(DISTINCT event_id) AS evenements,
  COUNT(DISTINCT installation_uuid) AS appareils,
  MIN(event_timestamp) AS premier,
  MAX(event_timestamp) AS dernier,
  ARRAY_AGG(STRUCT(
    _TABLE_SUFFIX AS table_app,
    error_type,
    application.display_version AS version,
    application.build_version AS build,
    device.manufacturer AS fabricant,
    device.model AS modele,
    blame_frame,
    exceptions
  ) ORDER BY event_timestamp DESC LIMIT 1)[OFFSET(0)] AS recent
FROM \`${projet}.firebase_crashlytics.${tables}*\`
WHERE event_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @jours DAY)
GROUP BY issue_id
ORDER BY evenements DESC
LIMIT 25`;
}

// Réponse de BigQuery (schéma + lignes en f/v) vers des objets simples.
function valeur(champ, brut) {
  if (brut === null || brut === undefined) return null;
  if (champ.mode === "REPEATED") {
    return Array.isArray(brut) ? brut.map((item) => valeur({ ...champ, mode: "NULLABLE" }, item?.v)) : [];
  }
  if (champ.type === "RECORD" || champ.type === "STRUCT") return ligne(champ.fields ?? [], brut);
  if (["INTEGER", "INT64"].includes(champ.type)) return Number(brut);
  if (champ.type === "TIMESTAMP") {
    const secondes = Number(brut);
    return Number.isFinite(secondes) ? new Date(secondes * 1000).toISOString() : null;
  }
  if (["BOOLEAN", "BOOL"].includes(champ.type)) return brut === "true" || brut === true;
  return typeof brut === "string" ? brut : String(brut);
}

function ligne(champs, brut) {
  const objet = {};
  const cellules = Array.isArray(brut?.f) ? brut.f : [];
  champs.forEach((champ, i) => {
    objet[champ.name] = valeur(champ, cellules[i]?.v);
  });
  return objet;
}

export function convertir(reponse) {
  const champs = reponse?.schema?.fields ?? [];
  return (reponse?.rows ?? []).map((brut) => ligne(champs, brut));
}

// Retire d'un texte ce qui pourrait identifier quelqu'un ou ouvrir un accès :
// adresses e-mail, paramètres d'URL, longues chaînes aléatoires (jetons, clés).
export function nettoyer(texte, max = 300) {
  if (typeof texte !== "string") return null;
  return texte
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<e-mail>")
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, "$1?<…>")
    .replace(/magnet:\?[^\s]*/gi, "magnet:<…>")
    .replace(/\b[A-Za-z0-9_\-+/=]{32,}\b/g, "<…>")
    .slice(0, max);
}

const texte = (valeurBrute) => (typeof valeurBrute === "string" && valeurBrute !== "" ? valeurBrute : null);

// Ne garde que l'utile et le non sensible d'une ligne.
function probleme(brut) {
  const recent = brut.recent ?? {};
  const exceptions = Array.isArray(recent.exceptions) ? recent.exceptions.filter(Boolean) : [];
  const exception = exceptions.at(-1) ?? exceptions[0] ?? {};
  const cadre = recent.blame_frame ?? {};
  const table = texte(recent.table_app) ?? "";
  return {
    id: texte(brut.issue_id),
    evenements: brut.evenements ?? 0,
    appareils: brut.appareils ?? 0,
    premier: brut.premier ?? null,
    dernier: brut.dernier ?? null,
    type: texte(recent.error_type),
    edition: /admin/i.test(table) ? "admin" : "publique",
    temps_reel: /_REALTIME$/.test(table),
    version: texte(recent.version),
    build: texte(recent.build),
    appareil: [texte(recent.fabricant), texte(recent.modele)].filter(Boolean).join(" ") || null,
    exception: nettoyer(texte(exception.type) ?? texte(exception.exception_type), 200),
    message: nettoyer(texte(exception.exception_message)),
    cause: {
      symbole: nettoyer(texte(cadre.symbol), 200),
      fichier: nettoyer(texte(cadre.file), 200),
      ligne: Number.isFinite(cadre.line) ? cadre.line : null,
      bibliotheque: nettoyer(texte(cadre.library), 200),
    },
  };
}

// Erreur BigQuery vers un état typé. Le message de BigQuery (noms de tables,
// de colonnes, position dans la requête) est rendu nettoyé en `detail`, pour
// qu'une vraie erreur puisse être corrigée sans deviner.
function erreurBigQuery(statut, corps) {
  const raison = corps?.error?.errors?.[0]?.reason ?? "";
  const message = String(corps?.error?.message ?? "");
  const detail = nettoyer(message) || undefined;
  // Table générique sans table correspondante : l'export n'a encore rien écrit.
  if (statut === 404 || raison === "notFound" || /not found|does not match any table/i.test(message)) {
    return { etat: "pas-encore" };
  }
  if (/bytesBilledLimitExceeded/i.test(raison)) return { etat: "plafond" };
  if (statut === 403 && /accessDenied|forbidden|permission/i.test(`${raison} ${message}`)) return { etat: "interdit", detail };
  if (statut === 403 && /billing|sandbox|quota/i.test(`${raison} ${message}`)) return { etat: "facturation", detail };
  if (statut === 400) return { etat: "requete", detail };
  if (statut === 401) return { etat: "refuse" };
  return { etat: "injoignable", detail };
}

// Avant la requête : le dataset existe-t-il, et contient-il déjà une table de
// l'app ? Distingue « lien absent » de « lien fait, premier export attendu ».
async function etatExport(projet, tables, jeton, fetchFn) {
  const reponse = await fetchFn(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${projet}/datasets/firebase_crashlytics/tables?maxResults=1000`,
    { redirect: "manual", signal: AbortSignal.timeout(DELAI), headers: { Authorization: `Bearer ${jeton}` } },
  );
  const corps = await reponse.json().catch(() => null);
  if (reponse.status === 404) return { etat: "pas-lie" };
  if (!reponse.ok) return erreurBigQuery(reponse.status, corps);
  const noms = (corps?.tables ?? []).map((t) => t?.tableReference?.tableId).filter((n) => typeof n === "string");
  return noms.some((n) => n.startsWith(tables)) ? null : { etat: "pas-encore" };
}

// Lit les problèmes des `jours` derniers jours. Rend { etat, problemes?, compte? }.
export async function lirePlantages(coffre, id, { jours = 7, fetchFn = fetch } = {}) {
  const definition = trouverApp(id);
  if (!definition?.crashlytics) throw new ErreurCoffre("requete-invalide");
  if (!coffre.ouvert) throw new ErreurCoffre("verrouille");
  if (!PERIODES.includes(jours)) throw new ErreurCoffre("requete-invalide");
  const brut = coffre.lire(DOSSIER_COMMUN, "FIREBASE_SERVICE_ACCOUNT");
  if (!brut) return { etat: "incomplet" };
  const lu = lireCompteGoogle(brut.valeur);
  if (!lu) return { etat: "invalide" };
  // Adresse publique du compte de service : c'est elle qui reçoit les rôles BigQuery.
  const compte = lu.compte.client_email;
  const { projet, tables } = definition.crashlytics;
  try {
    const { jeton, statut } = await jetonGoogle(lu, PORTEE, fetchFn);
    if (!jeton) return { etat: statut === 400 || statut === 401 ? "refuse" : "injoignable", compte };
    const absent = await etatExport(projet, tables, jeton, fetchFn);
    if (absent) return { ...absent, compte };
    const reponse = await fetchFn(`https://bigquery.googleapis.com/bigquery/v2/projects/${projet}/queries`, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(DELAI),
      headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: requete(projet, tables),
        useLegacySql: false,
        parameterMode: "NAMED",
        queryParameters: [{ name: "jours", parameterType: { type: "INT64" }, parameterValue: { value: String(jours) } }],
        timeoutMs: 30_000,
        maximumBytesBilled: OCTETS_MAX,
        useQueryCache: true,
      }),
    });
    const corps = await reponse.json().catch(() => null);
    if (!reponse.ok) return { ...erreurBigQuery(reponse.status, corps), compte };
    if (corps?.jobComplete !== true) return { etat: "lent", compte };
    const problemes = convertir(corps).map(probleme).filter((p) => p.id);
    return { etat: "ok", compte, jours, le: new Date().toISOString(), problemes };
  } catch {
    return { etat: "injoignable", compte };
  }
}

const date = (iso) => (iso ? iso.replace("T", " ").slice(0, 16) : "?");

// Rapport en Markdown, à coller dans une discussion : aucun secret, aucune
// donnée personnelle (pas d'identifiant d'installation ni d'utilisateur).
export function rapport(nomApp, resultat) {
  const lignes = [`# Plantages ${nomApp} (${resultat.jours} derniers jours, export Crashlytics)`, ""];
  if (resultat.problemes.length === 0) {
    lignes.push("Aucun plantage sur la période.");
    return lignes.join("\n");
  }
  resultat.problemes.forEach((p, i) => {
    lignes.push(`## ${i + 1}. ${p.exception ?? p.type ?? "Problème"} (${p.edition})`);
    lignes.push(
      `- ${p.evenements} événement(s) sur ${p.appareils} appareil(s), du ${date(p.premier)} au ${date(p.dernier)} (UTC)`,
      `- Type : ${p.type ?? "?"} · version ${p.version ?? "?"}${p.build ? ` (${p.build})` : ""} · ${p.appareil ?? "appareil inconnu"}`,
      `- Problème Crashlytics : ${p.id}`,
    );
    if (p.message) lignes.push(`- Message : ${p.message}`);
    const { symbole, fichier, ligne: numero, bibliotheque } = p.cause;
    if (symbole || fichier) {
      lignes.push(`- Cause probable : ${[symbole, fichier && `${fichier}${numero ? `:${numero}` : ""}`, bibliotheque].filter(Boolean).join(" · ")}`);
    }
    lignes.push("");
  });
  return lignes.join("\n");
}
