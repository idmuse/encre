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

  function setTheme(theme){
    document.documentElement.classList.toggle(DARK, theme === DARK);
    document.cookie = `${COOKIE}=${theme};max-age=31536000;path=/`;
    // Mettre à jour tous les boutons toggle de la page
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.textContent = theme === DARK ? '☀️' : '🌙';
      btn.title = theme === DARK ? 'Mode jour' : 'Mode nuit';
    });
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
    // Créer le bouton pour l'injecter dans les topbars/headers
    // Chaque page peut aussi placer <button class="theme-toggle-btn" onclick="toggleTheme()"> manuellement
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.textContent = theme === DARK ? '☀️' : '🌙';
      btn.title = theme === DARK ? 'Mode jour' : 'Mode nuit';
    });
  });
})();
