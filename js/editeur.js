// ── Point d'entrée — Éditeur ─────────────────────────────
import { initAuth, sbUser, setSaveStatus } from './auth.js';
import { getP, setP, resetP, getCI } from './state.js';
import { flash } from './utils.js';
import { sauvegarderCloud, chargerProjetCloud } from './cloud.js';
import { exportPdf, exportDocx, exportTxt } from './export.js';
import { ouvrirModalProfil, fermerModalProfil, sauvegarderProfil, verifierSlug, aperçuAvatar, copierLienProfil } from './profil.js';
import {
  renderSidebar, loadChap, save, ajouterChap, titreChap, edChange,
  alignerTexte, insererTexto, basculerCote, edKey,
  togglePlan, planTab, renderPlan,
  toggleCarnet, ouvrirCarnetPage, fermerCarnetPage,
  renderCarnetList, carnetNouveau, carnetSupprimer, carnetSauvegarder,
  chercherOccurrences, accToggle,
  openNew, openEdit, saveForm, delItem, closeForm,
  ouvrirFicheProjet, fermerModal,
  ltTogglePanel,
  ouvrirModalCorrections,
  showCtx, ctxDo,
  partagerLecture, sauvegarderLocal, charger, importerDocx, lireDocx,
  nouveauProjet, setNavActive, updateWC, repairerTextos,
} from './editor.js';

// ── Vérifier qu'on a un projet à éditer ──────────────────
// Si pas de projet en sessionStorage → retour index
function chargerDepuisSession() {
  const raw = sessionStorage.getItem('encre_projet_actif');
  if (!raw) { window.location.href = 'index.html'; return false; }
  try {
    const { projet, chapI } = JSON.parse(raw);
    setP(projet);
    // chapI sera restauré au loadChap
    return true;
  } catch(e) {
    window.location.href = 'index.html';
    return false;
  }
}

// Exposer au HTML
Object.assign(window, {
  renderSidebar, loadChap, save, ajouterChap, titreChap, edChange,
  alignerTexte, fmtCmd: (cmd) => { document.execCommand(cmd, false, null); document.getElementById('editor').focus(); },
  insererTexto, basculerCote, edKey,
  togglePlan, planTab, renderPlan,
  toggleCarnet, ouvrirCarnetPage, fermerCarnetPage,
  renderCarnetList, carnetNouveau, carnetSupprimer, carnetSauvegarder,
  chercherOccurrences, accToggle,
  openNew, openEdit, saveForm, delItem, closeForm,
  ouvrirFicheProjet, fermerModal,
  ltTogglePanel, ouvrirModalCorrections,
  showCtx, ctxDo,
  partagerLecture, sauvegarderLocal, charger, importerDocx, lireDocx,
  nouveauProjet, updateWC, repairerTextos,
  exportPdf, exportDocx, exportTxt,
  ouvrirModalProfil, fermerModalProfil, sauvegarderProfil, verifierSlug, aperçuAvatar, copierLienProfil,
  sauvegarderCloud,
  ouvrirDashboard: () => { window.location.href = 'index.html'; },
});

// ── Init ─────────────────────────────────────────────────
initAuth(
  async () => {
    if (!chargerDepuisSession()) return;
    document.getElementById('topbar').style.display = '';
    document.getElementById('app').style.display = '';
    document.getElementById('sb').style.display = '';
    renderSidebar();
    loadChap(getCI());
    setSaveStatus('ok');
  },
  () => {
    window.location.href = 'index.html';
  }
);

// Sauvegarde auto Ctrl+S
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    sauvegarderCloud();
  }
});
