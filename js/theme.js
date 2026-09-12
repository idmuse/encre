// theme.js — Gestion du mode nuit sur toutes les pages encre
// Inclure après le CSS : <script src="js/theme.js"></script>

(function(){
  const COOKIE = 'encre_theme';
  const DARK   = 'dark';
  const LIGHT  = 'light';

  // Lire le thème sauvegardé (cookie) ou préférence système
  function getTheme(){
    const cookie = document.cookie.split(';')
      .map(c => c.trim())
      .find(c => c.startsWith(COOKIE + '='));
    if(cookie) return cookie.split('=')[1];
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
  }

  // Icônes du bouton (trait fin, cohérentes avec le reste du bandeau) — un
  // simple croissant pour le mode nuit, un soleil pour repasser en mode jour.
  const MOON_PATH = 'M15 11.5A6 6 0 0 1 8.5 5 6 6 0 1 0 15 11.5Z';
  const SUN_PATH  = 'M10 3v2.2M10 14.8V17M3 10h2.2M14.8 10H17M5.5 5.5l1.6 1.6M12.9 12.9l1.6 1.6M5.5 14.5l1.6-1.6M12.9 7.1l1.6-1.6M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z';

  function majBoutonToggle(btn, theme){
    btn.title = theme === DARK ? 'Mode jour' : 'Mode nuit';
    const svg = btn.querySelector('svg');
    if(svg){
      // Bouton redessiné (icône SVG) : on change juste le tracé, sans toucher au DOM.
      const path = svg.querySelector('path');
      if(path) path.setAttribute('d', theme === DARK ? SUN_PATH : MOON_PATH);
    } else {
      // Ancien bouton (emoji en texte, pages pas encore redessinées).
      btn.textContent = theme === DARK ? '☀️' : '🌙';
    }
  }

  function setTheme(theme){
    document.documentElement.classList.toggle(DARK, theme === DARK);
    document.cookie = `${COOKIE}=${theme};max-age=31536000;path=/`;
    // Mettre à jour tous les boutons toggle de la page
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => majBoutonToggle(btn, theme));
  }

  function toggle(){
    const actuel = document.documentElement.classList.contains(DARK) ? DARK : LIGHT;
    setTheme(actuel === DARK ? LIGHT : DARK);
  }

  // Appliquer immédiatement au chargement (avant le rendu pour éviter le flash)
  setTheme(getTheme());

  // Exposer globalement
  window.toggleTheme = toggle;
  window.getTheme    = getTheme;

  // Ajouter le bouton dans tous les headers au chargement du DOM
  document.addEventListener('DOMContentLoaded', () => {
    const theme = getTheme();
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => majBoutonToggle(btn, theme));
  });
})();
