// ── Profil auteur ────────────────────────────────────────
import { sb, sbUser } from './auth.js';
import { flash } from './utils.js';

async function ouvrirModalProfil(){
  if(!sbUser){ alert('Connectez-vous pour gérer votre profil.'); return; }
  // Charger profil depuis Supabase
  const { data } = await sb.from('profils').select('*').eq('user_id', sbUser.id).maybeSingle();
  if(data){
    document.getElementById('p-pseudo').value  = data.pseudo   || '';
    document.getElementById('p-slug').value    = data.slug     || '';
    document.getElementById('p-bio').value      = data.bio      || '';
    document.getElementById('p-genres').value   = data.genres   || '';
    document.getElementById('p-site').value     = data.site     || '';
    document.getElementById('p-reseaux').value  = data.reseaux  || '';
    document.getElementById('p-avatar').value   = data.avatar   || '';
    aperçuAvatar(data.avatar||'');
  }
  const slugVal = document.getElementById('p-slug').value || sbUser.id;
  const base = window.location.href.replace(/encre\.html.*$/, '');
  const lienEl = document.getElementById('p-lien-public');
  const lienUrl = base + 'profil.html?a=' + slugVal;
  lienEl.textContent = lienUrl;
  lienEl.href = lienUrl;
  document.getElementById('p-slug').addEventListener('input', e=>{
    const s = e.target.value || sbUser.id;
    const lEl = document.getElementById('p-lien-public');
    const lUrl = base + 'profil.html?a=' + s;
    lEl.textContent = lUrl;
    lEl.href = lUrl;
    verifierSlug(s);
  });
  const bg = document.getElementById('modal-profil-bg');
  bg.style.display = 'flex';
  document.getElementById('p-avatar').addEventListener('input', e=>aperçuAvatar(e.target.value));
}

export function aperçuAvatar(url){
  const el = document.getElementById('p-avatar-preview');
  if(url && url.startsWith('http')){
    el.innerHTML = `<img src="${url}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;margin-top:6px;border:2px solid var(--paper3)" onerror="this.style.display='none'">`;
  } else { el.innerHTML = ''; }
}

export function fermerModalProfil(){
  document.getElementById('modal-profil-bg').style.display = 'none';
}

export function copierLienProfil(){
  const url = document.getElementById('p-lien-public').href;
  if(!url || url==='#') return;
  navigator.clipboard.writeText(url).then(()=>flash('Lien copié ✓')).catch(()=>{
    // fallback
    const ta = document.createElement('textarea');
    ta.value = url; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    flash('Lien copié ✓');
  });
}

export async function verifierSlug(slug){
  const el = document.getElementById('p-slug-status');
  if(!slug){ el.textContent=''; return; }
  const {data} = await sb.from('profils').select('user_id').eq('slug',slug).neq('user_id',sbUser.id).maybeSingle();
  if(data){ el.style.color='var(--accent)'; el.textContent='✗ Déjà pris'; }
  else { el.style.color='#4a8050'; el.textContent='✓ Disponible'; }
}

export async function sauvegarderProfil(){
  if(!sbUser) return;
  const slugChoisi = document.getElementById('p-slug').value.trim();
  if(slugChoisi){
    // Vérifier unicité
    const {data:existing} = await sb.from('profils').select('user_id').eq('slug',slugChoisi).neq('user_id',sbUser.id).maybeSingle();
    if(existing){ alert('Ce slug est déjà pris, choisissez-en un autre.'); return; }
  }
  const profil = {
    user_id  : sbUser.id,
    slug     : slugChoisi || null,
    pseudo   : document.getElementById('p-pseudo').value.trim(),
    bio      : document.getElementById('p-bio').value.trim(),
    genres   : document.getElementById('p-genres').value.trim(),
    site     : document.getElementById('p-site').value.trim(),
    reseaux  : document.getElementById('p-reseaux').value.trim(),
    avatar   : document.getElementById('p-avatar').value.trim(),
    mis_a_jour: new Date().toISOString()
  };
  const { error } = await sb.from('profils').upsert(profil, { onConflict: 'user_id' });
  if(error){ alert('Erreur : '+error.message); return; }
  flash('Profil sauvegardé ✓');
  fermerModalProfil();
}

