// ── État global ───────────────────────────────────────────
// P = projet en cours. Toujours accéder via getP() / updateP()
// pour éviter les mutations silencieuses.

const _defaultP = () => ({
  titre: 'Sans titre',
  sousTitre: '',
  auteur: '',
  genre: '',
  annee: new Date().getFullYear(),
  synopsis: '',
  chapitres: [{ id: 1, titre: 'Chapitre 1', contenu: '', mots: 0, niveau: 2 }],
  nid: 2,
  stats: {},
  _totalMotsSauve: null,
  projet_cloud_id: null,
  personnages: [],
  lieux: [],
  notes: [],
  carnet: [],
  echeance: null,
});

let _P = _defaultP();
let _chapI = 0;

export const getP  = ()        => _P;
export const getCI = ()        => _chapI;
export const setCI = (i)       => { _chapI = i; };
export const resetP = ()       => { _P = _defaultP(); _chapI = 0; };
export const setP  = (data)    => { _P = data; };

export function updateP(partial) {
  Object.assign(_P, partial);
}

export function aujourdhui() {
  return new Date().toISOString().slice(0, 10);
}

export function totalMotsProjet() {
  return _P.chapitres.reduce((s, c) => s + (c.mots || 0), 0);
}

export function mettreAJourStatsJour() {
  const today = aujourdhui();
  if (!_P.stats) _P.stats = {};
  const totalActuel = totalMotsProjet();
  const baseline = _P._totalMotsSauve ?? totalActuel;
  const diff = Math.max(0, totalActuel - baseline);
  if (diff > 0) _P.stats[today] = (_P.stats[today] || 0) + diff;
  _P._totalMotsSauve = totalActuel;
}
