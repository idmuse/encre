// ── Utilitaires ───────────────────────────────────────────

export function flash(msg) {
  let el = document.getElementById('flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flash';
    el.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:var(--ink1);color:var(--paper2);padding:8px 20px;border-radius:20px;
      font-family:'Crimson Pro',serif;font-size:14px;z-index:99999;
      opacity:0;transition:opacity .2s;pointer-events:none;`;
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

export function dl(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function fmt(n) {
  return Number(n).toLocaleString('fr-FR');
}

export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function rom(n) {
  const v = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const s = ['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let r = '';
  v.forEach((val, i) => { while (n >= val) { r += s[i]; n -= val; } });
  return r;
}

export function aujourdhui() {
  return new Date().toISOString().slice(0, 10);
}

export function calculerStreak(statsJours) {
  const aujourd = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(aujourd);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (statsJours[key] > 0) streak++;
    else if (i > 0) break;
  }
  return streak;
}
