// ── Cloud / Dashboard ────────────────────────────────────
import { sb, sbUser, pseudoProfil, setSaveStatus } from './auth.js';
import { getP, setP, resetP, getCI, mettreAJourStatsJour, totalMotsProjet, aujourdhui } from './state.js';
import { flash, fmt, esc, calculerStreak } from './utils.js';
import { STATUT_LABELS, STATUT_COLORS } from './config.js';

export let dbProjets = [];

async function sauvegarderCloud(){
  if(!sbUser){ flash('Non connecté'); return; }
  save();
  mettreAJourStatsJour(); // calculer les nouveaux mots avant d'envoyer
  flash('Sauvegarde…');
  const contenu = JSON.parse(JSON.stringify(P));
  if(contenu.personnages) contenu.personnages = contenu.personnages.map(p=>({...p, photo: p.photo ? '(photo)' : null}));
  contenu.projet_cloud_id = null;

  let error;
  if(P.projet_cloud_id){
    const res = await sb.from('projets')
      .update({ nom: P.titre||'Sans titre', contenu, mis_a_jour: new Date().toISOString() })
      .eq('id', P.projet_cloud_id).eq('user_id', sbUser.id);
    error = res.error;
  } else {
    const res = await sb.from('projets')
      .insert({ user_id: sbUser.id, nom: P.titre||'Sans titre', contenu, mis_a_jour: new Date().toISOString() })
      .select('id').single();
    error = res.error;
    if(!error && res.data) P.projet_cloud_id = res.data.id;
  }
  if(error){ flash('Erreur : ' + error.message); console.error(error); setSaveStatus('err'); return; }
  flash('Sauvegardé dans le cloud ✓'); setSaveStatus('ok');
  renderSidebar(); // rafraîchir le wordcount dans la sidebar

  // Pousser les stats agrégées vers le profil
  majStatsProfilCloud();
}

export async function majStatsProfilCloud(){
  if(!sbUser) return;
  // Récupérer tous les projets pour agréger
  const { data: projets } = await sb.from('projets')
    .select('id,nom,contenu,public')
    .eq('user_id', sbUser.id);
  if(!projets) return;

  let totalMots = 0;
  const statsJours = {}; // { 'YYYY-MM-DD': mots }
  let objectifEnCours = null;
  const projetsPublics = [];

  projets.forEach(row=>{
    const c = row.contenu||{};
    const mots = (c.chapitres||[]).reduce((s,ch)=>s+(ch.mots||0),0);
    totalMots += mots;
    // Fusionner les stats journalières
    if(c.stats) Object.entries(c.stats).forEach(([d,m])=>{
      statsJours[d] = (statsJours[d]||0) + m;
    });
    // Objectif du projet actif
    if(row.id === P.projet_cloud_id && c.echeance?.objectif){
      objectifEnCours = { titre: c.titre||row.nom, mots, objectif: c.echeance.objectif, fin: c.echeance.fin||null };
    }
    // Projets publics
    if(row.public){
      projetsPublics.push({ id: row.id, nom: row.nom, mots, genre: c.genre||'', annee: c.annee||'', synopsis: c.synopsis||'', couverture: c.echeance?.couverture||null });
    }
  });

  // Calculer le streak
  const streak = calculerStreak(statsJours);

  const statsPayload = { totalMots, statsJours, objectifEnCours, streak, projetsPublics, mis_a_jour: new Date().toISOString() };
  await sb.from('profils')
    .upsert({ user_id: sbUser.id, stats: statsPayload }, { onConflict: 'user_id' });
}


export async function toggleProjetPublic(id, e){
  e.stopPropagation();
  const row = dbProjets.find(r=>r.id===id);
  if(!row) return;
  const nouvelEtat = !row.public;
  const { error } = await sb.from('projets').update({ public: nouvelEtat }).eq('id', id).eq('user_id', sbUser.id);
  if(error){ alert('Erreur : '+error.message); return; }
  row.public = nouvelEtat;
  renderDashboard();
  majStatsProfilCloud(); // resync profil
  flash(nouvelEtat ? 'Projet affiché sur le profil public ✓' : 'Projet masqué du profil public');
}

// ── CHARGER DEPUIS LE CLOUD ───────────────────────────────
export async function ouvrirProjets(){
  if(!sbUser){ return; }
  document.getElementById('projets-modal').classList.add('on');
  const list = document.getElementById('projets-list');
  list.innerHTML = '<div style="font-family:\'Crimson Pro\',serif;font-size:14px;color:var(--ink4);padding:8px 0">Chargement…</div>';

  const { data, error } = await sb.from('projets')
    .select('id,nom,mis_a_jour,contenu')
    .eq('user_id', sbUser.id)
    .order('mis_a_jour', { ascending: false });

  if(error){ list.innerHTML = '<div style="color:var(--accent);font-size:13px">Erreur : '+error.message+'</div>'; return; }
  if(!data?.length){ list.innerHTML = '<div style="font-family:\'Crimson Pro\',serif;font-size:14px;color:var(--ink4);font-style:italic;padding:8px 0">Aucun projet sauvegardé.</div>'; return; }

  list.innerHTML = '';
  data.forEach(row=>{
    const d = new Date(row.mis_a_jour);
    const dateStr = d.toLocaleDateString('fr-CA') + ' ' + d.toLocaleTimeString('fr-CA',{hour:'2-digit',minute:'2-digit'});
    const ligne = document.createElement('div');
    ligne.className = 'projet-ligne';
    ligne.innerHTML = `<span class="projet-ligne-titre">${row.nom}</span>
      <span class="projet-ligne-date">${dateStr}</span>
      <button class="projet-ligne-del" onclick="supprimerProjetCloud('${row.id}',event)" title="Supprimer">✕</button>`;
    ligne.onclick = (e)=>{ if(e.target.classList.contains('projet-ligne-del')) return; chargerProjetCloud(row); };
    list.appendChild(ligne);
  });
}

function fermerProjets(){ document.getElementById('projets-modal').classList.remove('on'); }

export function chargerProjetCloud(row){
  // Préparer le projet
  const projet = row.contenu || {};
  projet.projet_cloud_id = row.id;
  if(!projet.nid) projet.nid = 100;

  // Réparer les chapitres dont le contenu est un bloc fusionné
  (projet.chapitres||[]).forEach(ch => {
    if(!ch.contenu) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = ch.contenu;
    const kids = Array.from(tmp.childNodes);
    if(kids.length === 1 && kids[0].nodeType === 3){
      const paras = kids[0].textContent.split('\n').filter(s=>s.trim());
      if(paras.length > 1) ch.contenu = paras.map(p=>`<div>${p}</div>`).join('');
    }
  });

  // Passer le projet à l'éditeur via sessionStorage et naviguer
  sessionStorage.setItem('encre_projet_actif', JSON.stringify({ projet, chapI: 0 }));
  window.location.href = 'editeur.html';
}

export async function supprimerProjetCloud(id, e){
  e.stopPropagation();
  if(!confirm('Supprimer ce projet du cloud ?')) return;
  const { error } = await sb.from('projets').delete().eq('id', id).eq('user_id', sbUser.id);
  if(error){ flash('Erreur suppression'); return; }
  ouvrirProjets();
}
</script>

<!-- MODAL COMMENTAIRES -->
<div id="comm-dash-modal" onclick="if(event.target===this)fermerCommentairesDash()">
  <div id="comm-dash-box">
    <div id="comm-dash-head">
      <h3 id="comm-dash-titre">Commentaires</h3>
      <button onclick="fermerCommentairesDash()" style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:18px;">✕</button>
    </div>
    <div id="comm-dash-list"></div>
  </div>
</div>

<!-- TABLEAU DE BORD -->
<div id="dashboard">
  <div id="db-topbar">
    <div class="logo"><em>encre</em></div>
    <div class="tb-sep" style="background:#3a3028;margin:0 8px"></div>
    <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#6b5a4e;letter-spacing:.08em;text-transform:uppercase">Projets</span>
    <div id="db-topbar-right">
      <span id="db-user"></span>
      <button class="tb-btn" onclick="ouvrirModalProfil()" style="color:#c4a882">✍ Mon profil</button>
    </div>
  </div>
  <div id="db-body">
    <div id="db-greeting" style="font-family:'Playfair Display',serif;font-size:26px;font-weight:400;color:var(--ink);margin-bottom:32px;line-height:1.4;"></div>

    <h2>Mes projets</h2>
    <div id="db-projets-grid"></div>

    <div id="db-stats-section">
      <h2>Stats d'écriture</h2>
      <select id="stats-projet-select" onchange="renderStats()">
        <option value="_all">Tous les projets</option>
      </select>
      <div class="stats-grid" id="stats-cards"></div>
      <div id="stats-barchart"></div>
      <div style="margin-top:12px;margin-bottom:24px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <button onclick="calNavMois(-1)" style="font-family:'Crimson Pro',serif;font-size:16px;background:none;border:1px solid var(--paper3);border-radius:4px;padding:4px 10px;cursor:pointer;color:var(--ink3);">&#8592;</button>
        <span id="cal-mois-label" style="font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--ink4);min-width:110px;text-align:center;"></span>
        <button onclick="calNavMois(1)" id="cal-nav-next" style="font-family:'Crimson Pro',serif;font-size:16px;background:none;border:1px solid var(--paper3);border-radius:4px;padding:4px 10px;cursor:pointer;color:var(--ink3);">&#8594;</button>
        <button onclick="exporterCalendrier()" style="font-family:'Crimson Pro',serif;font-size:14px;background:none;border:1px solid var(--paper3);border-radius:4px;padding:6px 14px;cursor:pointer;color:var(--ink3);">📅 Exporter</button>
      </div>
      <div id="prog-bar-section"></div>
      <div id="badges-section">
        <h3>Badges</h3>
        <h4>Session & Streak</h4>
        <div class="badges-grid" id="badges-session"></div>
        <h4>Ce mois-ci</h4>
        <div class="badges-grid" id="badges-mois"></div>
        <h4>Cette année</h4>
        <div class="badges-grid" id="badges-annee"></div>
      </div>
    </div>

    <div id="db-gantt-section">
      <h2>Échéancier</h2>
      <div id="db-gantt"></div>
    </div>
  </div>
</div>

<!-- MODAL CRÉATION PROJET -->
<div id="creation-modal" onclick="if(event.target===this)fermerCreation()" style="position:fixed;inset:0;background:rgba(26,20,16,.55);z-index:9000;display:none;align-items:center;justify-content:center;padding:16px;">
  <div style="background:var(--paper);border-radius:8px;padding:24px;width:100%;max-width:420px;max-height:90vh;overflow-y:auto;box-sizing:border-box;">
    <h3 style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:18px;font-weight:600;">Nouveau projet</h3>
    <label class="ll">Titre *</label>
    <input class="li" id="cr-titre" placeholder="Le titre de ton roman…">
    <label class="ll">Auteur·e</label>
    <input class="li" id="cr-auteur" placeholder="Ton nom…">
    <label class="ll">Sous-titre</label>
    <input class="li" id="cr-sous" placeholder="Sous-titre optionnel…">
    <div style="display:flex;gap:10px">
      <div style="flex:1"><label class="ll">Genre</label><input class="li" id="cr-genre" placeholder="Roman, Nouvelle…"></div>
      <div style="flex:1"><label class="ll">Année</label><input class="li" id="cr-annee" placeholder="2025"></div>
    </div>
    <label class="ll">Synopsis</label>
    <textarea class="li" id="cr-synopsis" style="resize:none;min-height:60px;line-height:1.5" placeholder="En quelques phrases…"></textarea>
    <div style="height:1px;background:var(--paper3);margin:14px 0"></div>
    <label class="ll">Statut</label>
    <select class="li" id="cr-statut" style="font-family:'Crimson Pro',serif">
      <option value="idee">Idée</option>
      <option value="ecriture">Écriture</option>
      <option value="beta">Bêta-lecture</option>
      <option value="reecriture">Réécriture</option>
      <option value="correction">Correction</option>
      <option value="relecture">Relecture finale</option>
      <option value="editeur">Envoi à l'éditeur</option>
      <option value="pause">En pause</option>
    </select>
    <div style="display:flex;gap:10px">
      <div style="flex:1"><label class="ll">Date de début</label><input class="li" type="date" id="cr-debut"></div>
      <div style="flex:1"><label class="ll">Date de remise ✉</label><input class="li" type="date" id="cr-fin"></div>
    </div>
    <label class="ll">Date de publication 📖</label>
    <input class="li" type="date" id="cr-publication">
    <label class="ll">Objectif de mots</label>
    <input class="li" type="number" id="cr-objectif" placeholder="ex: 80000">
    <div class="fbr" style="margin-top:12px">
      <button class="fb fb-s" onclick="creerProjetDashboard()">Créer le projet</button>
      <button class="fb fb-c" onclick="fermerCreation()">Annuler</button>
    </div>
  </div>
</div>

<!-- MODAL ÉCHÉANCE -->
<div id="echeance-modal" onclick="if(event.target===this)fermerEcheance()">
  <div id="echeance-box">
    <h3 id="echeance-titre">Échéances</h3>
    <label class="ll">Date de début</label>
    <input class="li" type="date" id="ech-debut">
    <label class="ll">Date de remise du manuscrit ✉</label>
    <input class="li" type="date" id="ech-fin">
    <label class="ll">Date de publication 📖</label>
    <input class="li" type="date" id="ech-publication">
    <label class="ll">Statut</label>
    <select class="li" id="ech-statut" style="font-family:'Crimson Pro',serif">
      <option value="idee">Idée</option>
      <option value="ecriture">Écriture</option>
      <option value="beta">Bêta-lecture</option>
      <option value="reecriture">Réécriture</option>
      <option value="correction">Correction</option>
      <option value="relecture">Relecture finale</option>
      <option value="editeur">Envoi à l'éditeur</option>
      <option value="pause">En pause</option>
    </select>
    <label class="ll">Objectif de mots</label>
    <input class="li" type="number" id="ech-objectif" placeholder="ex: 80000">
    <label class="ll">Couverture</label>
    <div id="ech-couv-preview" style="margin-bottom:8px"></div>
    <input type="file" id="ech-couv-input" accept="image/*" style="display:none" onchange="couvEcheanceLue(this)">
    <button class="pb" onclick="document.getElementById('ech-couv-input').click()" style="margin-bottom:12px;width:100%;padding:6px">Choisir une image de couverture</button>
    <div class="fbr" style="margin-top:8px">
      <button class="fb fb-s" onclick="sauverEcheance()">Sauvegarder</button>
      <button class="fb fb-c" onclick="fermerEcheance()">Annuler</button>
    </div>
  </div>
</div>

<script>
// ── CRÉATION PROJET DEPUIS LE DASHBOARD ───────────────────
export function ouvrirCreationProjet(){
  // Pré-remplir l'année
  document.getElementById('cr-titre').value = '';
  document.getElementById('cr-auteur').value = sbUser?.email?.split('@')[0] || '';
  document.getElementById('cr-sous').value = '';
  document.getElementById('cr-genre').value = '';
  document.getElementById('cr-annee').value = new Date().getFullYear();
  document.getElementById('cr-synopsis').value = '';
  document.getElementById('cr-statut').value = 'idee';
  document.getElementById('cr-debut').value = '';
  document.getElementById('cr-fin').value = '';
  document.getElementById('cr-publication').value = '';
  document.getElementById('cr-objectif').value = '';
  document.getElementById('creation-modal').style.display = 'flex';
  setTimeout(()=>document.getElementById('cr-titre').focus(), 50);
}

export function fermerCreation(){
  document.getElementById('creation-modal').style.display = 'none';
}

export async function creerProjetDashboard(){
  const titre = document.getElementById('cr-titre').value.trim();
  if(!titre){ document.getElementById('cr-titre').focus(); return; }

  const contenu = {
    titre,
    auteur:    document.getElementById('cr-auteur').value.trim(),
    sousTitre: document.getElementById('cr-sous').value.trim(),
    genre:     document.getElementById('cr-genre').value.trim(),
    annee:     document.getElementById('cr-annee').value.trim(),
    synopsis:  document.getElementById('cr-synopsis').value.trim(),
    chapitres: [{ id:1, titre:'Chapitre I', contenu:'', mots:0 }],
    personnages:[], lieux:[], timeline:[], nid:2,
    projet_cloud_id: null,
    echeance: {
      statut:   document.getElementById('cr-statut').value,
      debut:    document.getElementById('cr-debut').value,
      fin:      document.getElementById('cr-fin').value,
      publication: document.getElementById('cr-publication').value,
      objectif: parseInt(document.getElementById('cr-objectif').value)||0
    }
  };

  const { data, error } = await sb.from('projets')
    .insert({ user_id: sbUser.id, nom: titre, contenu, mis_a_jour: new Date().toISOString() })
    .select('id').single();

  if(error){ alert('Erreur : ' + error.message); return; }

  // Mettre à jour le projet_cloud_id dans le contenu
  contenu.projet_cloud_id = data.id;
  await sb.from('projets').update({ contenu }).eq('id', data.id);

  fermerCreation();
  await chargerTousProjets();
  // Proposer d'ouvrir le projet créé
  const row = { id: data.id, nom: titre, contenu };
  if(confirm(`Projet "${titre}" créé ! Ouvrir maintenant dans l'éditeur ?`)){
    chargerProjetCloud(row);
  }
}

// ── STATS D'ÉCRITURE ──────────────────────────────────────
function aujourdhui(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function enregistrerStats(mots){
  if(mots <= 0) return;
  const date = aujourdhui();
  if(!P.stats) P.stats = {};
  P.stats[date] = (P.stats[date] || 0) + mots;
}

function getStatsSource(){
  // Toujours lire depuis dbProjets (Supabase) + projet actif en mémoire
  const sel = document.getElementById('stats-projet-select')?.value;
  const merged = {};

  dbProjets.forEach(row => {
    if(sel && sel !== '_all' && row.id !== sel) return;
    const s = row.contenu?.stats || {};
    Object.entries(s).forEach(([date, mots]) => {
      merged[date] = (merged[date] || 0) + mots;
    });
  });

  // Ajouter le projet actif si pas dans dbProjets (nouveau non sauvegardé)
  if(P.stats && P.projet_cloud_id){
    const dejaInclus = dbProjets.some(r=>r.id===P.projet_cloud_id && (!sel || sel==='_all' || sel===P.projet_cloud_id));
    if(!dejaInclus){
      Object.entries(P.stats).forEach(([date,mots])=>{
        merged[date] = (merged[date]||0) + mots;
      });
    }
  }
  return merged;
}

export function renderStats(){
  const stats = getStatsSource();
  const today = aujourdhui();
  const now = new Date();
  const moisCle = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const annee = now.getFullYear().toString();

  const motAujourdhui = stats[today] || 0;
  const motsMois = Object.entries(stats).filter(([d])=>d.startsWith(moisCle)).reduce((s,[,m])=>s+m,0);
  const motsAnnee = Object.entries(stats).filter(([d])=>d.startsWith(annee)).reduce((s,[,m])=>s+m,0);

  let streak = 0;
  const d = new Date();
  while(true){
    const cle = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if(stats[cle] && stats[cle] > 0){ streak++; d.setDate(d.getDate()-1); } else break;
    if(streak > 365) break;
  }

  const cards = document.getElementById('stats-cards');
  cards.innerHTML = `
    <div class="stats-card">
      <div class="stats-card-val">${motAujourdhui.toLocaleString('fr-FR')}</div>
      <div class="stats-card-label">Mots aujourd'hui</div>
    </div>
    <div class="stats-card">
      <div class="stats-card-val stats-streak">${streak} 🔥</div>
      <div class="stats-card-label">Jours consécutifs</div>
      <div class="stats-card-sub">${streak===0?'Commence aujourd\'hui !':streak===1?'C\'est parti !':'Continue !'}</div>
    </div>
    <div class="stats-card">
      <div class="stats-card-val">${motsMois.toLocaleString('fr-FR')}</div>
      <div class="stats-card-label">Ce mois-ci</div>
      <div class="stats-card-sub">${now.toLocaleString('fr-FR',{month:'long'})}</div>
    </div>
    <div class="stats-card">
      <div class="stats-card-val">${motsAnnee.toLocaleString('fr-FR')}</div>
      <div class="stats-card-label">Cette année</div>
      <div class="stats-card-sub">${annee}</div>
    </div>`;

  // Graphique — mois sélectionné (piloté par _calOffset)
  const chart = document.getElementById('stats-barchart');
  const refMois = new Date(now.getFullYear(), now.getMonth() + _calOffset, 1);
  const dernierDuMois = new Date(refMois.getFullYear(), refMois.getMonth()+1, 0).getDate();
  const isCurrentMonth = refMois.getFullYear()===now.getFullYear() && refMois.getMonth()===now.getMonth();
  const jourActuel = now.getDate();
  const jours = [];
  for(let j=1; j<=dernierDuMois; j++){
    const cle = `${refMois.getFullYear()}-${String(refMois.getMonth()+1).padStart(2,'0')}-${String(j).padStart(2,'0')}`;
    jours.push({ label: (isCurrentMonth && j===jourActuel)?'Auj':String(j), mots: stats[cle]||0, isToday: isCurrentMonth && j===jourActuel });
  }
  const maxMots=Math.max(...jours.map(j=>j.mots),1);
  const moisLabel = refMois.toLocaleString('fr-FR',{month:'long',year:'numeric'});
  chart.innerHTML=`
    <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ink4);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">${moisLabel}</div>
    <div class="barchart-inner">
      ${jours.map(j=>`<div class="bar-col"><div class="bar-fill${j.isToday?' today':''}" style="height:${Math.max(4,Math.round(j.mots/maxMots*76))}px">${j.mots>0?`<span class="bar-tip">${j.mots.toLocaleString('fr-FR')} mots</span>`:''}</div><div class="bar-label">${j.label}</div></div>`).join('')}
    </div>`;

  renderBadges(motAujourdhui, motsMois, motsAnnee, streak, stats);
  renderProgressBar(motsMois);
  _updateCalLabel();
}

function renderProgressBar(motsMois){
  const section = document.getElementById('prog-bar-section');
  if(!section) return;

  // Paliers mensuels
  const paliers = [1000, 5000, 10000, 25000, 50000];
  const prochain = paliers.find(p => motsMois < p) || null;

  if(!prochain){
    section.innerHTML = `<div style="font-family:'Crimson Pro',serif;font-size:14px;color:var(--gold);font-style:italic">🎯 Tu as atteint tous les objectifs mensuels ! Incroyable !</div>`;
    return;
  }

  const precedent = paliers[paliers.indexOf(prochain) - 1] || 0;
  const pct = Math.min(100, Math.round((motsMois - precedent) / (prochain - precedent) * 100));
  const restant = (prochain - motsMois).toLocaleString('fr-FR');
  const prochainFmt = prochain.toLocaleString('fr-FR');
  const motsFmt = motsMois.toLocaleString('fr-FR');

  section.innerHTML = `
    <div id="prog-bar-wrap">
      <div id="prog-bar-fill" style="width:${pct}%"></div>
    </div>
    <div id="prog-bar-label">
      <span>${motsFmt} mots</span>
      <span>encore ${restant} mots → ${prochainFmt}</span>
    </div>`;
}

function renderBadges(motJour, motsMois, motsAnnee, streak, stats){
  const maxJour = Math.max(...Object.values(stats), 0);
  const joursEcrits = Object.values(stats).filter(m=>m>0).length;

  function badgeHTML(b){
    return `<div class="badge ${b.earned?'earned':'locked'}" title="${b.desc}">
      <div class="badge-icon">${b.icon}</div>
      <div class="badge-nom">${b.nom}</div>
      ${b.prog && !b.earned ? `<div class="badge-prog">${b.prog}</div>` : ''}
    </div>`;
  }

  const SESSION = [
    { icon:'✏️', nom:'Premier mot',  desc:'Écrire au moins 1 mot',      earned: joursEcrits >= 1 },
    { icon:'📝', nom:'En route',     desc:'500 mots en une journée',     earned: maxJour >= 500 },
    { icon:'🔥', nom:'En feu',       desc:'1 000 mots en une journée',   earned: maxJour >= 1000 },
    { icon:'⭐', nom:'Belle journée', desc:'2 000 mots en une journée',   earned: maxJour >= 2000 },
    { icon:'🏆', nom:'Champion·ne',   desc:'5 000 mots en une journée',   earned: maxJour >= 5000 },
    { icon:'🌱', nom:'3 jours',      desc:'3 jours consécutifs',         earned: streak >= 3 },
    { icon:'⚡', nom:'1 sem',    desc:'7 jours consécutifs',         earned: streak >= 7 },
    { icon:'💫', nom:'2 sem',    desc:'14 jours consécutifs',        earned: streak >= 14 },
    { icon:'🌟', nom:'1 mois',       desc:'30 jours consécutifs',        earned: streak >= 30 },
    { icon:'👑', nom:'100 jours',    desc:'100 jours consécutifs',       earned: streak >= 100 },
  ];

  const MOIS = [
    { icon:'📖', nom:'10k',  desc:'10 000 mots ce mois-ci', earned: motsMois >= 10000 },
    { icon:'💎', nom:'25k',  desc:'25 000 mots ce mois-ci', earned: motsMois >= 25000 },
    { icon:'🎯', nom:'50k',  desc:'50 000 mots ce mois-ci', earned: motsMois >= 50000 },
  ];

  const ANNEE = [
    { icon:'🚀', nom:'100k', desc:'100 000 mots cette année', earned: motsAnnee >= 100000 },
    { icon:'✨', nom:'250k', desc:'250 000 mots cette année', earned: motsAnnee >= 250000 },
    { icon:'🌈', nom:'500k', desc:'500 000 mots cette année', earned: motsAnnee >= 500000 },
  ];

  document.getElementById('badges-session').innerHTML = SESSION.map(badgeHTML).join('');
  document.getElementById('badges-mois').innerHTML = MOIS.map(badgeHTML).join('');
  document.getElementById('badges-annee').innerHTML = ANNEE.map(badgeHTML).join('');
}

// ── Navigation calendrier ────────────────────────────────────────────────────
let _calOffset = 0; // 0 = mois courant, -1 = mois précédent, etc.

function calNavMois(delta) {
  _calOffset += delta;
  if (_calOffset > 0) _calOffset = 0;
  renderStats();
}

function _updateCalLabel() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + _calOffset, 1);
  const label = d.toLocaleString('fr-FR', {month:'long', year:'numeric'});
  const el = document.getElementById('cal-mois-label');
  if (el) el.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  // Désactiver → si on est au mois courant
  const next = document.getElementById('cal-nav-next');
  if (next) next.disabled = _calOffset >= 0;
}

function exporterCalendrier(){
  const now = new Date();
  const ref = new Date(now.getFullYear(), now.getMonth() + _calOffset, 1);
  const annee = ref.getFullYear();
  const mois = ref.getMonth();
  const moisNom = ref.toLocaleString('fr-FR',{month:'long',year:'numeric'});
  const moisNomCap = moisNom.charAt(0).toUpperCase() + moisNom.slice(1);

  // Collecter stats de tous les projets pour ce mois
  const stats = {};
  dbProjets.forEach(row => {
    const s = row.contenu?.stats || {};
    Object.entries(s).forEach(([date, mots]) => {
      const d = new Date(date);
      if(d.getFullYear()===annee && d.getMonth()===mois)
        stats[d.getDate()] = (stats[d.getDate()]||0) + mots;
    });
  });
  if(P.stats) Object.entries(P.stats).forEach(([date, mots]) => {
    const d = new Date(date);
    if(d.getFullYear()===annee && d.getMonth()===mois)
      stats[d.getDate()] = (stats[d.getDate()]||0) + mots;
  });

  // Dimensions — cellules compactes
  const COLS = 7;
  const cellW = 100, cellH = 56;
  const padX = 32, padTop = 80, padBot = 36;
  const jours = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

  // Calculer nb de semaines
  const premierJour = new Date(annee, mois, 1);
  const dernierJour = new Date(annee, mois+1, 0);
  const nbJours = dernierJour.getDate();
  const debutCol = (premierJour.getDay()+6)%7; // 0=Lun
  const nbSemaines = Math.ceil((debutCol + nbJours) / 7);

  const W = COLS * cellW + padX*2;
  const H = padTop + nbSemaines * cellH + padBot + 30;

  const canvas = document.createElement('canvas');
  canvas.width = W * 2; canvas.height = H * 2; // retina
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  // Fond
  ctx.fillStyle = '#faf7f2';
  ctx.fillRect(0, 0, W, H);

  // Titre
  ctx.fillStyle = '#1a1410';
  ctx.font = 'italic 24px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('encre', padX + COLS*cellW/2, 32);
  ctx.font = '12px monospace';
  ctx.fillStyle = '#8c7b6e';
  ctx.fillText(moisNomCap, padX + COLS*cellW/2, 50);

  // En-têtes jours
  ctx.font = '9px monospace';
  ctx.fillStyle = '#8c7b6e';
  jours.forEach((j, i) => {
    ctx.textAlign = 'center';
    ctx.fillText(j.toUpperCase(), padX + i*cellW + cellW/2, padTop - 8);
  });

  // Max pour couleur relative
  const maxMots = Math.max(...Object.values(stats), 1);
  const today = new Date();
  const isCurrentMonth = today.getFullYear()===annee && today.getMonth()===mois;

  // Cellules
  for(let jour=1; jour<=nbJours; jour++){
    const idx = debutCol + jour - 1;
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const x = padX + col * cellW;
    const y = padTop + row * cellH;
    const mots = stats[jour] || 0;

    // Fond de cellule
    if(mots > 0){
      const alpha = 0.15 + (mots / maxMots) * 0.65;
      ctx.fillStyle = `rgba(196, 98, 45, ${alpha})`;
    } else {
      ctx.fillStyle = '#f0ebe3';
    }
    ctx.beginPath();
    ctx.roundRect(x+2, y+2, cellW-4, cellH-4, 5);
    ctx.fill();

    // Numéro du jour
    const isToday = isCurrentMonth && today.getDate()===jour;
    ctx.fillStyle = mots > 0 ? '#1a1410' : '#c4b49e';
    ctx.font = `${isToday ? 'bold ' : ''}11px monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(jour, x+7, y+16);

    // Nombre de mots
    if(mots > 0){
      ctx.fillStyle = '#1a1410';
      ctx.font = 'bold 13px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(mots.toLocaleString('fr-FR'), x+cellW/2, y+cellH/2+6);
      ctx.font = '8px monospace';
      ctx.fillStyle = '#4a3f35';
      ctx.fillText('mots', x+cellW/2, y+cellH/2+17);
    }
  }

  // Bordure légère
  ctx.strokeStyle = '#ede5d8';
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, padTop, COLS*cellW, nbSemaines*cellH);

  // Total du mois
  const total = Object.values(stats).reduce((s,m)=>s+m, 0);
  const badgesMois = [];
  if(total >= 10000) badgesMois.push('📖');
  if(total >= 25000) badgesMois.push('💎');
  if(total >= 50000) badgesMois.push('🎯');

  ctx.fillStyle = '#8c7b6e';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  const totalTxt = `Total : ${total.toLocaleString('fr-FR')} mots`;
  const badgesTxt = badgesMois.join(' ');
  ctx.fillText(totalTxt + (badgesTxt ? '  ' + badgesTxt : ''), padX + COLS*cellW/2, H - 10);

  // Télécharger
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `encre_${annee}-${String(mois+1).padStart(2,'0')}.png`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

export function peuplerSelectStats(){
  const sel = document.getElementById('stats-projet-select');
  if(!sel) return;
  const val = sel.value;
  sel.innerHTML = '<option value="_all">Tous les projets</option>';
  dbProjets.forEach(row => {
    const opt = document.createElement('option');
    opt.value = row.id;
    opt.textContent = row.nom;
    sel.appendChild(opt);
  });
  sel.value = val || '_all';
}

// ── DASHBOARD ─────────────────────────────────────────────
let dbProjets = []; // cache des projets chargés depuis Supabase
let echeanceId = null; // id du projet en cours d'édition

export async function ouvrirDashboard(){
  fermerCarnetPage();
  if(planMode) togglePlan();
  document.getElementById('dashboard').classList.add('on');
  document.getElementById('topbar').style.display='none';
  document.getElementById('app').style.display='none';
  document.getElementById('sb').style.display='none';
  // Charger le pseudo du profil pour la salutation
  const { data: profilData } = await sb.from('profils').select('pseudo').eq('user_id', sbUser.id).maybeSingle();
  window._pseudoProfil = profilData?.pseudo || sbUser?.email?.split('@')[0] || '';
  document.getElementById('db-user').textContent = window._pseudoProfil;
  setNavActive('nav-projets');
  await chargerTousProjets();
}

export function fermerDashboard(){
  document.getElementById('dashboard').classList.remove('on');
  document.getElementById('topbar').style.display='';
  document.getElementById('app').style.display='';
  document.getElementById('sb').style.display='';
  setNavActive(null);
}

function ouvrirCarnetPage(){
  if(planMode) togglePlan();
  document.getElementById('dashboard').classList.remove('on');
  document.getElementById('topbar').style.display='none';
  document.getElementById('app').style.display='none';
  document.getElementById('sb').style.display='none';
  document.getElementById('carnet-page').style.display='flex';
  setNavActive('nav-carnet');
  if(carnetActif !== null) renderCarnetEditor(carnetActif);
  else renderCarnetList();
}

function fermerCarnetPage(){
  document.getElementById('carnet-page').style.display='none';
  document.getElementById('topbar').style.display='';
  document.getElementById('app').style.display='';
  document.getElementById('sb').style.display='';
  setNavActive(null);
}

export async function chargerTousProjets(){
  if(!sbUser) return;
  const grid = document.getElementById('db-projets-grid');
  grid.innerHTML = '<div style="font-family:\'Crimson Pro\',serif;font-size:14px;color:var(--ink4);padding:8px 0;grid-column:1/-1">Chargement…</div>';

  const { data, error } = await sb.from('projets')
    .select('id,nom,mis_a_jour,contenu,public')
    .eq('user_id', sbUser.id)
    .order('mis_a_jour', { ascending: false });

  if(error){ grid.innerHTML = '<div style="color:var(--accent)">Erreur : '+error.message+'</div>'; return; }
  dbProjets = (data || []).sort((a,b)=>{
    const fa = a.contenu?.echeance?.fin;
    const fb = b.contenu?.echeance?.fin;
    if(fa && fb) return new Date(fa) - new Date(fb);
    if(fa) return -1;
    if(fb) return 1;
    return new Date(b.mis_a_jour) - new Date(a.mis_a_jour);
  });
  renderDashboard();
}

export function renderDashboard(){
  renderGreeting();
  renderDbGrid();
  renderGantt();
  peuplerSelectStats();
  renderStats();
}

export function renderGreeting(){
  const el = document.getElementById('db-greeting');
  if(!el) return;
  const h = new Date().getHours();
  const prenom = window._pseudoProfil || sbUser?.email?.split('@')[0] || '';
  const salut = h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';

  // Mots écrits aujourd'hui (tous projets)
  const today = aujourdhui();
  let motsAujourdhui = 0;
  dbProjets.forEach(row => { motsAujourdhui += row.contenu?.stats?.[today] || 0; });
  if(P.stats?.[today]) motsAujourdhui = Math.max(motsAujourdhui, P.stats[today]);

  let msg = `${salut}, ${prenom} !`;
  if(motsAujourdhui > 0){
    msg += `<span style="font-style:italic;color:var(--ink3);font-size:20px;display:block;margin-top:6px">Tu as écrit ${motsAujourdhui.toLocaleString('fr-FR')} mots aujourd'hui. ✨</span>`;
  } else {
    const encouragements = [
      'Prête à écrire ?',
      'L\'histoire attend.',
      'C\'est parti ?',
      'Les mots t\'attendent.',
    ];
    const e = encouragements[new Date().getDate() % encouragements.length];
    msg += `<span style="font-style:italic;color:var(--ink3);font-size:20px;display:block;margin-top:6px">${e}</span>`;
  }
  el.innerHTML = msg;
}

const STATUT_COLORS = {
  idee:'#9c8878', ecriture:'#2a6b6b', beta:'#7a5c9c', reecriture:'#b8892a',
  correction:'#c4622d', relecture:'#6b8a3a', editeur:'#4a8050', pause:'#6b5a4e'
};
const STATUT_LABELS = {
  idee:'Idée', ecriture:'Écriture', beta:'Bêta-lecture', reecriture:'Réécriture',
  correction:'Correction', relecture:'Relecture finale', editeur:'Envoi à l\'éditeur', pause:'En pause'
};

export function renderDbGrid(){
  const grid = document.getElementById('db-projets-grid');
  grid.innerHTML = '';

  dbProjets.forEach(row=>{
    const c = row.contenu || {};
    const mots = (c.chapitres||[]).reduce((s,ch)=>s+(ch.mots||0),0);
    const objectif = c.echeance?.objectif || 0;
    const pct = objectif ? Math.min(100, Math.round(mots/objectif*100)) : null;
    const statut = c.echeance?.statut || 'idee';
    const fin = c.echeance?.fin;
    const estActif = P.projet_cloud_id === row.id;

    const pub = c.echeance?.publication;
    let pubHtml = '';
    if(pub){
      const pubDate = new Date(pub);
      const isPast = pubDate < new Date();
      pubHtml = `<div style="font-family:'JetBrains Mono',monospace;font-size:9px;margin-top:3px;color:${isPast?'#4a8050':'var(--gold)'}">📖 ${pubDate.toLocaleDateString('fr-CA')}</div>`;
    }
    if(fin){
      const diff = Math.ceil((new Date(fin) - new Date()) / 86400000);
      const cls = diff < 0 ? 'urgent' : diff < 14 ? 'bientot' : 'ok';
      const txt = diff < 0 ? `En retard de ${-diff}j` : diff === 0 ? 'Aujourd\'hui !' : `Dans ${diff} jours`;
      echeanceHtml = `<div class="db-card-echeance ${cls}">${txt} — ${new Date(fin).toLocaleDateString('fr-CA')}</div>`;
    }

    const card = document.createElement('div');
    card.className = 'db-projet-card' + (estActif ? ' actif' : '');
    const couv = c.echeance?.couverture;
    const couvHtml = couv
      ? `<img src="${couv}" class="db-card-couv" onclick="ouvrirEcheance('${row.id}',event)" title="Changer la couverture">`
      : `<div class="db-card-couv-placeholder" onclick="ouvrirEcheance('${row.id}',event)">+ Couverture</div>`;
    card.innerHTML = `
      <button class="db-card-del" onclick="supprimerProjetDash('${row.id}',event)" title="Supprimer">✕</button>
      ${couvHtml}
      <div class="db-card-titre">${row.nom}</div>
      <div class="db-card-auteur">${c.auteur||''}</div>
      <div class="db-card-meta">
        <span class="db-card-mots">${mots.toLocaleString('fr-FR')} mots${objectif?' / '+objectif.toLocaleString('fr-FR'):''}</span>
        <span class="db-card-statut" style="background:${STATUT_COLORS[statut]}22;color:${STATUT_COLORS[statut]}">${STATUT_LABELS[statut]}</span>
      </div>
      ${pct!==null?`<div style="margin-top:8px;height:3px;background:var(--paper3);border-radius:2px"><div style="width:${pct}%;height:100%;background:${STATUT_COLORS[statut]};border-radius:2px"></div></div>`:''}
      ${echeanceHtml}
      ${pubHtml}
      <div class="db-card-date">Modifié ${new Date(row.mis_a_jour).toLocaleDateString('fr-CA')}</div>
      <div style="margin-top:10px;display:flex;gap:6px">
        <button onclick="ouvrirDepuisDash('${row.id}',event)" style="flex:1;padding:5px;background:var(--accent);border:none;border-radius:4px;color:#fff;font-family:'Crimson Pro',serif;font-size:12px;cursor:pointer">Ouvrir</button>
        <button onclick="ouvrirEcheance('${row.id}',event)" style="flex:1;padding:5px;background:none;border:1px solid var(--paper3);border-radius:4px;color:var(--ink3);font-family:'Crimson Pro',serif;font-size:12px;cursor:pointer">Échéances</button>
        <button onclick="ouvrirCommentairesDash('${row.id}','${row.nom}',event)" style="flex:1;padding:5px;background:none;border:1px solid var(--paper3);border-radius:4px;color:var(--ink3);font-family:'Crimson Pro',serif;font-size:12px;cursor:pointer" id="btn-comm-${row.id}">💬</button>
        <button onclick="toggleProjetPublic('${row.id}',event)" title="${row.public?'Retirer du profil public':'Afficher sur le profil public'}" style="padding:5px 7px;background:none;border:1px solid var(--paper3);border-radius:4px;color:${row.public?'var(--gold)':'var(--ink3)'};font-size:13px;cursor:pointer">${row.public?'🌐':'🔒'}</button>
      </div>`;
    grid.appendChild(card);
  });

  // Carte nouveau projet
  const newCard = document.createElement('div');
  newCard.className = 'db-new-card';
  newCard.innerHTML = '＋ Nouveau projet';
  newCard.onclick = ouvrirCreationProjet;
  grid.appendChild(newCard);
}

export function renderGantt(){
  const gantt = document.getElementById('db-gantt');
  const projetsAvecDates = dbProjets.filter(r=>(r.contenu?.echeance?.debut||r.contenu?.echeance?.fin||r.contenu?.echeance?.publication));
  if(!projetsAvecDates.length){
    gantt.innerHTML = '<div style="padding:20px 16px;font-family:\'Crimson Pro\',serif;font-size:14px;color:var(--ink4);font-style:italic">Aucune échéance définie — cliquez sur "Échéances" dans une carte pour en ajouter.</div>';
    return;
  }

  const today = new Date(); today.setHours(0,0,0,0);
  let minDate = new Date(today); minDate.setMonth(minDate.getMonth()-1);
  let maxDate = new Date(today); maxDate.setMonth(maxDate.getMonth()+6);

  projetsAvecDates.forEach(r=>{
    const e = r.contenu?.echeance || {};
    if(e.debut)       { const d=new Date(e.debut);       if(d<minDate) minDate=d; }
    if(e.fin)         { const d=new Date(e.fin);         if(d>maxDate) maxDate=d; }
    if(e.publication) { const d=new Date(e.publication); if(d>maxDate) maxDate=d; }
  });
  minDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  maxDate = new Date(maxDate.getFullYear(), maxDate.getMonth()+1, 0);
  const totalMs = maxDate - minDate;

  const mois = [];
  let cur = new Date(minDate);
  while(cur <= maxDate){ mois.push(new Date(cur)); cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1); }
  const MOIS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

  let html = `<div class="gantt-header">
    <div class="gantt-label" style="font-family:'JetBrains Mono',monospace;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink4)">Projet</div>
    <div class="gantt-months">${mois.map(m=>`<div class="gantt-month">${MOIS_FR[m.getMonth()]} ${m.getFullYear()}</div>`).join('')}</div>
  </div>`;

  projetsAvecDates.forEach(row=>{
    const e = row.contenu?.echeance || {};
    const statut = e.statut || 'idee';
    const debut = e.debut ? new Date(e.debut) : new Date(minDate);
    const fin   = e.fin   ? new Date(e.fin)   : (e.publication ? new Date(e.publication) : new Date(today));

    const left  = Math.max(0,(debut-minDate)/totalMs*100);
    const width = Math.max(0.5,(fin-debut)/totalMs*100);
    const color = STATUT_COLORS[statut]||'#9c8878';

    // Point de publication sur la barre (petit cercle vert)
    const pubDot = e.publication ? (()=>{
      const pPct = Math.max(0, Math.min(100, (new Date(e.publication)-minDate)/totalMs*100));
      const dateStr = new Date(e.publication).toLocaleDateString('fr-CA');
      return `<div style="position:absolute;top:50%;left:${pPct}%;transform:translate(-50%,-50%);width:12px;height:12px;border-radius:50%;background:#4a8050;border:2px solid #fff;cursor:default;z-index:2;" title="Publication : ${dateStr}"></div>`;
    })() : '';

    html += `<div class="gantt-row" ondblclick="ouvrirEcheance('${row.id}',event)" style="cursor:pointer" title="Double-cliquer pour voir les échéances">
      <div class="gantt-label" title="${row.nom}">${row.nom}</div>
      <div class="gantt-track">
        <div class="gantt-today" style="left:${(today-minDate)/totalMs*100}%"></div>
        <div class="gantt-bar" style="left:${left}%;width:${width}%;background:${color}" title="${row.nom}">
          ${width > 4 ? row.nom : ''}
        </div>
        ${pubDot}
      </div>
    </div>`;
  });

  gantt.innerHTML = html;
}

// ── ÉCHÉANCES ─────────────────────────────────────────────
let echCouvTmp = null;

export function ouvrirEcheance(id, e){
  e.stopPropagation();
  echeanceId = id;
  echCouvTmp = null;
  const row = dbProjets.find(r=>r.id===id);
  const ech = row?.contenu?.echeance || {};
  document.getElementById('echeance-titre').textContent = 'Échéances — ' + (row?.nom||'');
  document.getElementById('ech-debut').value = ech.debut||'';
  document.getElementById('ech-fin').value = ech.fin||'';
  document.getElementById('ech-publication').value = ech.publication||'';
  document.getElementById('ech-statut').value = ech.statut||'idee';
  document.getElementById('ech-objectif').value = ech.objectif||'';
  // Aperçu couverture existante
  const prev = document.getElementById('ech-couv-preview');
  prev.innerHTML = ech.couverture
    ? `<img src="${ech.couverture}" style="width:100%;max-height:140px;object-fit:cover;border-radius:5px;margin-bottom:4px">`
    : '';
  document.getElementById('echeance-modal').classList.add('on');
}

export function fermerEcheance(){
  document.getElementById('echeance-modal').classList.remove('on');
  echeanceId=null; echCouvTmp=null;
}

function couvEcheanceLue(input){
  const file=input.files[0]; if(!file) return;
  // Redimensionner la couv avant stockage
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const canvas=document.createElement('canvas');
      const maxW=400, maxH=600;
      let w=img.width, h=img.height;
      if(w>maxW){ h=Math.round(h*maxW/w); w=maxW; }
      if(h>maxH){ w=Math.round(w*maxH/h); h=maxH; }
      canvas.width=w; canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      echCouvTmp=canvas.toDataURL('image/jpeg',0.85);
      document.getElementById('ech-couv-preview').innerHTML=
        `<img src="${echCouvTmp}" style="width:100%;max-height:140px;object-fit:cover;border-radius:5px;margin-bottom:4px">`;
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file); input.value='';
}

export async function sauverEcheance(){
  if(!echeanceId) return;
  const row = dbProjets.find(r=>r.id===echeanceId);
  if(!row) return;
  const ech = {
    debut:       document.getElementById('ech-debut').value,
    fin:         document.getElementById('ech-fin').value,
    publication: document.getElementById('ech-publication').value,
    statut:      document.getElementById('ech-statut').value,
    objectif:    parseInt(document.getElementById('ech-objectif').value)||0,
    couverture:  echCouvTmp !== null ? echCouvTmp : (row.contenu?.echeance?.couverture||null)
  };
  const contenu = { ...(row.contenu||{}), echeance: ech };
  const { error } = await sb.from('projets')
    .update({ contenu, mis_a_jour: new Date().toISOString() })
    .eq('id', echeanceId).eq('user_id', sbUser.id);
  if(error){ alert('Erreur : '+error.message); return; }
  row.contenu = contenu;
  fermerEcheance();
  renderDashboard();
  if(P.projet_cloud_id === echeanceId) P.echeance = ech;
}

export async function ouvrirCommentairesDash(id, nom, e){
  e.stopPropagation();
  document.getElementById('comm-dash-titre').textContent = `Commentaires — ${nom}`;
  document.getElementById('comm-dash-list').innerHTML = '<div style="padding:20px;font-family:\'Crimson Pro\',serif;color:var(--ink4);font-style:italic">Chargement…</div>';
  document.getElementById('comm-dash-modal').classList.add('on');

  const { data, error } = await sb.from('commentaires')
    .select('*').eq('projet_id', id).order('cree_le', {ascending: false});

  const list = document.getElementById('comm-dash-list');
  if(error || !data?.length){
    list.innerHTML = '<div style="padding:24px 20px;font-family:\'Crimson Pro\',serif;font-size:15px;color:var(--ink4);font-style:italic;text-align:center">Aucun commentaire pour l\'instant.</div>';
    return;
  }
  list.innerHTML = '';
  data.forEach(c => {
    const item = document.createElement('div');
    item.className = 'comm-dash-item';
    const date = new Date(c.cree_le).toLocaleDateString('fr-CA');
    item.innerHTML = `
      <div class="comm-dash-body">
        <div class="comm-dash-auteur">${c.auteur}</div>
        ${c.contexte ? `<div class="comm-dash-ctx">«\u00a0${c.contexte}\u00a0»</div>` : ''}
        <div class="comm-dash-texte">${c.texte}</div>
        <div class="comm-dash-date">${date}</div>
      </div>
      <button class="comm-dash-del" onclick="supprimerComm('${c.id}',this)" title="Supprimer">✕</button>`;
    list.appendChild(item);
  });
}

export function fermerCommentairesDash(){
  document.getElementById('comm-dash-modal').classList.remove('on');
}

export async function supprimerComm(id, btn){
  if(!confirm('Supprimer ce commentaire ?')) return;
  const { error } = await sb.from('commentaires').delete().eq('id', id);
  if(error){ alert('Erreur : ' + error.message); return; }
  btn.closest('.comm-dash-item').remove();
  // Vérifier si plus aucun commentaire
  if(!document.querySelector('.comm-dash-item')){
    document.getElementById('comm-dash-list').innerHTML = '<div style="padding:24px 20px;font-family:\'Crimson Pro\',serif;font-size:15px;color:var(--ink4);font-style:italic;text-align:center">Aucun commentaire.</div>';
  }
}

// ── Profil auteur ─────────────────────────────────────────
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

function aperçuAvatar(url){
  const el = document.getElementById('p-avatar-preview');
  if(url && url.startsWith('http')){
    el.innerHTML = `<img src="${url}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;margin-top:6px;border:2px solid var(--paper3)" onerror="this.style.display='none'">`;
  } else { el.innerHTML = ''; }
}

function fermerModalProfil(){
  document.getElementById('modal-profil-bg').style.display = 'none';
}

function copierLienProfil(){
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

async function verifierSlug(slug){
  const el = document.getElementById('p-slug-status');
  if(!slug){ el.textContent=''; return; }
  const {data} = await sb.from('profils').select('user_id').eq('slug',slug).neq('user_id',sbUser.id).maybeSingle();
  if(data){ el.style.color='var(--accent)'; el.textContent='✗ Déjà pris'; }
  else { el.style.color='#4a8050'; el.textContent='✓ Disponible'; }
}

async function sauvegarderProfil(){
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

export function ouvrirDepuisDash(id, e){
  e.stopPropagation();
  const row = dbProjets.find(r=>r.id===id);
  if(!row) return;
  chargerProjetCloud(row);
  fermerDashboard();
}

export async function supprimerProjetDash(id, e){
  e.stopPropagation();
  const row = dbProjets.find(r=>r.id===id);
  if(!confirm(`Supprimer "${row?.nom}" du cloud ?`)) return;
  const { error } = await sb.from('projets').delete().eq('id', id).eq('user_id', sbUser.id);
  if(error){ alert('Erreur : '+error.message); return; }
  dbProjets = dbProjets.filter(r=>r.id!==id);
  renderDashboard();
}
</script>
