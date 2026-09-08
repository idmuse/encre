// ── Point d'entrée — Dashboard ───────────────────────────
import { initAuth, seConnecter as authSeConnecter, sbUser } from './auth.js';
import {
  ouvrirDashboard, fermerDashboard, chargerTousProjets,
  renderDashboard, ouvrirCreationProjet, fermerCreation, creerProjetDashboard,
  ouvrirEcheance, fermerEcheance, sauverEcheance,
  ouvrirCommentairesDash, fermerCommentairesDash, supprimerComm,
  toggleProjetPublic, ouvrirDepuisDash, supprimerProjetDash,
  renderStats, peuplerSelectStats
} from './cloud.js';
import { ouvrirModalProfil, fermerModalProfil, sauvegarderProfil, verifierSlug, aperçuAvatar, copierLienProfil } from './profil.js';
import { flash } from './utils.js';

// Exposer au HTML (onclick=)
Object.assign(window, {
  ouvrirDashboard, fermerDashboard,
  ouvrirCreationProjet, fermerCreation, creerProjetDashboard,
  ouvrirEcheance, fermerEcheance, sauverEcheance,
  ouvrirCommentairesDash, fermerCommentairesDash, supprimerComm,
  toggleProjetPublic, ouvrirDepuisDash, supprimerProjetDash,
  renderStats, peuplerSelectStats,
  ouvrirModalProfil, fermerModalProfil, sauvegarderProfil, verifierSlug, aperçuAvatar, copierLienProfil,
  seConnecter: async () => {
    const email = document.getElementById('login-email').value;
    const pwd   = document.getElementById('login-pwd').value;
    document.getElementById('login-error').textContent = '';
    try {
      await authSeConnecter(email, pwd);
    } catch(e) {
      document.getElementById('login-error').textContent = e.message;
    }
  }
});

// Auth
initAuth(
  // connecté → dashboard
  async () => {
    document.getElementById('login-screen').classList.add('hidden');
    await ouvrirDashboard();
  },
  // déconnecté → login
  () => {
    document.getElementById('login-screen').classList.remove('hidden');
  }
);

// Enter sur le login
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.closest('#login-box')) {
    window.seConnecter();
  }
});
