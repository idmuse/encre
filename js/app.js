
// ── État ──────────────────────────────────────────────────
let P = {
  titre:'Mon Roman',
  auteur:'', sousTitre:'', genre:'', annee: new Date().getFullYear()+'', synopsis:'',
  chapitres:[{id:1,titre:'Chapitre I',contenu:'',mots:0}],
  personnages:[], lieux:[], timeline:[], recherches:[], nid:2
};
let chapI=0, ctxSel='', editId=null, photoTmp=null;

const _EDITEUR = window.location.pathname.includes('editeur');
const _INDEX   = !_EDITEUR;

// Sur l'éditeur, charger le projet depuis sessionStorage IMMÉDIATEMENT
let _baselineSession = null; // gardé pour compatibilité
let _snapshotOuverture = null; // total de mes chapitres au dernier snapshot (ouverture ou sauvegarde)
let _motsDejaAujourdhui = 0; // mots déjà enregistrés aujourd'hui dans stats_ecriture (lu au chargement)
let _collabPretResolve = null;
const _collabPret = new Promise(resolve => { _collabPretResolve = resolve; });
if(_EDITEUR){
  const _raw = sessionStorage.getItem('encre_projet_actif');
  if(!_raw){ window.location.href = 'index.html'; }
  else {
    try {
      P = JSON.parse(_raw).projet;
      // Nettoyer les photos fantômes sauvegardées avant le fix de compression
      if(P.personnages) P.personnages.forEach(p=>{
        if(p.photo && (p.photo==='(photo)' || !p.photo.startsWith('data:'))) p.photo=null;
      });
      // Baseline provisoire — sera recalculée dans afficherApp() une fois sbUser connu
      _baselineSession = P.chapitres.reduce((s,c) => s + (c.mots||0), 0);
    }
    catch(e){ window.location.href = 'index.html'; }
  }
}

// Libérer les verrous à la fermeture + tentative de sauvegarde sync
window.addEventListener('beforeunload', (e)=>{
  if(_EDITEUR){
    libererTousVerrous();
    // Sauvegarder le chapitre actif dans le backup local seulement s'il n'est pas sauvegardé
    try {
      const c = P.chapitres[chapI];
      if(c && c._dirty === true){ // seulement si explicitement dirty (pas false ni undefined)
        const key = `encre_backup_${P.projet_cloud_id||'local'}_ch${c.id}`;
        localStorage.setItem(key, JSON.stringify({
          contenu: c.contenu, mots: c.mots, titre: c.titre,
          ts: new Date().toISOString()
        }));
      }
    } catch(err) { /* pas critique */ }
    // Tenter une sauvegarde cloud via sendBeacon (best-effort, non-bloquant)
    if(sbUser && P.projet_cloud_id){
      const c = P.chapitres[chapI];
      if(c && c._dirty){
        const payload = JSON.stringify({
          projet_id: P.projet_cloud_id,
          chapitre_id: c.id,
          contenu: c.contenu || '',
          mots: c.mots || 0,
          mis_a_jour: new Date().toISOString(),
          modifie_par: sbUser.id
        });
        // Note: sendBeacon vers Supabase nécessite un endpoint REST direct
        // On marque le chapitre pour resync au prochain chargement via le backup local
      }
    }
  }
});

// Nettoyage automatique des backups locaux de plus de 24h
// SAUF si le backup contient plus de mots que le cloud (protection contre perte de texte)
try {
  const DELAI = 24 * 60 * 60 * 1000;
  Object.keys(localStorage)
    .filter(k => k.startsWith('encre_backup_'))
    .forEach(k => {
      try {
        const b = JSON.parse(localStorage.getItem(k));
        if(!b?.ts) { localStorage.removeItem(k); return; }
        const age = Date.now() - new Date(b.ts);
        if(age > DELAI){
          // Ne pas effacer si le backup a du contenu et est récent (protection)
          // On efface seulement les backups vides ou très vieux (7 jours)
          if(!b.contenu || age > 7 * 24 * 60 * 60 * 1000){
            localStorage.removeItem(k);
          }
        }
      } catch(e) { localStorage.removeItem(k); }
    });
} catch(e) {}

document.addEventListener('DOMContentLoaded',()=>{
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') fermerModal?.(); });
  if(_EDITEUR){
    document.execCommand('defaultParagraphSeparator', false, 'p');

    // ── Post-processeur dictée vocale ─────────────────────
    const DICT_REMPLACEMENTS = [
      [/\btiret cadratin\b/gi,        ' \u2014 '],
      [/\btiret long\b/gi,            ' \u2014 '],
      [/\bpoints? de suspension\b/gi, '\u2026'],
      [/\bpoint d.interrogation\b/gi, '?'],
      [/\bpoint d.exclamation\b/gi,   '!'],
      [/\bdeux points\b/gi,           '\u00a0:'],
      [/\bouvrir (?:les )?guillemets?\b/gi, '«\u00a0'],
      [/\bfermer (?:les )?guillemets?\b/gi, '\u00a0»'],
      [/\balinéa\b/gi,                '\n'],
      [/\bnouveau paragraphe\b/gi,    '\n'],
      [/\bpoint virgule\b/gi,         ';'],
      [/\bvirgule\b/gi,               ','],
    ];
    let _dictProcessing = false;
    const _dictObserver = new MutationObserver(() => {
      if(_dictProcessing) return;
      const ed = document.getElementById('editor');
      if(!ed) return;
      const txt = ed.innerText;
      const needsReplace = DICT_REMPLACEMENTS.some(([re]) => { re.lastIndex=0; return re.test(txt); });
      if(!needsReplace) return;
      _dictProcessing = true;
      const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let n;
      while(n = walker.nextNode()) nodes.push(n);
      nodes.forEach(node => {
        let val = node.textContent;
        let changed = false;
        DICT_REMPLACEMENTS.forEach(([re, rep]) => {
          re.lastIndex = 0;
          if(re.test(val)){ val = val.replace(re, rep); changed = true; }
        });
        if(changed) node.textContent = val;
      });
      // Newlines → nouveaux paragraphes
      if(ed.innerHTML.includes('\n')){
        ed.innerHTML = ed.innerHTML.replace(/\n/g, '</p><p>');
      }
      // Curseur à la fin
      try {
        const last = ed.lastElementChild || ed;
        const r = document.createRange();
        r.selectNodeContents(last); r.collapse(false);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      } catch(e){}
      edChange();
      _dictProcessing = false;
    });
    setTimeout(() => {
      const ed = document.getElementById('editor');
      if(ed) _dictObserver.observe(ed, { childList:true, subtree:true, characterData:true });
    }, 800);
    // ─────────────────────────────────────────────────────
    // Remettre tous les chapitres à "pas modifié" au chargement
    // Évite que des _dirty résiduels du sessionStorage déclenchent des saves fantômes
    P.chapitres.forEach(ch => { ch._dirty = false; });
    renderSidebar(); updateSbProjet();
    // loadChap est appelé APRÈS le chargement async des auteur_id (voir bloc collab plus bas)
    // Pour les projets solo (pas de projet_cloud_id), on charge immédiatement
    if(!P.projet_cloud_id || !sbUser) loadChap(0);
    accToggle('perso');

    // Le chargement collab est fait dans afficherApp() une fois sbUser connu
    // Vérifier si un backup local est plus récent que le cloud
    setTimeout(verifierBackupLocal, 1500);
    document.addEventListener('click', ()=>{ const ctx=document.getElementById('ctx'); if(ctx) ctx.style.display='none'; });
    abonnerVerrous();

    // Nettoyage du collage — forcer le texte brut en <p>
    const ed=document.getElementById('editor');
    if(ed) ed.addEventListener('paste',e=>{
      e.preventDefault();
      const texte=e.clipboardData.getData('text/plain');
      if(!texte) return;
      const paragraphes=texte.split(/\n{2,}/).map(p=>p.replace(/\n/g,' ').trim()).filter(Boolean);
      const html=paragraphes.length>1
        ? paragraphes.map(p=>`<p>${p}</p>`).join('')
        : `<p>${texte.replace(/\n/g,'</p><p>')}</p>`;
      document.execCommand('insertHTML', false, html);
      // Déclencher input manuellement car execCommand ne le fait pas toujours
      document.getElementById('editor').dispatchEvent(new Event('input'));
      // Puis recalculer après stabilisation du DOM
      setTimeout(() => edChange(), 1000);
    });
  }
});

// ── NAVIGATION MOBILE ────────────────────────────────────
function mnavSetActive(id){
  document.querySelectorAll('.mnav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}
function mnavWrite(){
  document.getElementById('sidebar')?.classList.remove('mob-open');
  document.getElementById('panel')?.classList.remove('mob-open');
  mnavSetActive('mnav-write');
  document.getElementById('editor')?.focus();
}
function mnavChapitres(){
  const sb=document.getElementById('sidebar');
  const isOpen=sb?.classList.contains('mob-open');
  document.getElementById('panel')?.classList.remove('mob-open');
  if(isOpen){ sb.classList.remove('mob-open'); mnavSetActive('mnav-write'); }
  else{ sb?.classList.add('mob-open'); mnavSetActive('mnav-chaps'); }
}
function mnavPanel(){
  const panel=document.getElementById('panel');
  const isOpen=panel?.classList.contains('mob-open');
  document.getElementById('sidebar')?.classList.remove('mob-open');
  if(isOpen){ panel.classList.remove('mob-open'); mnavSetActive('mnav-write'); }
  else{ panel?.classList.add('mob-open'); mnavSetActive('mnav-panel'); }
}

// ── SERVICE WORKER DÉSACTIVÉ ─────────────────────────────
// (retiré pour éviter les problèmes de cache lors des mises à jour)

// ── Fiche projet (modal) ──────────────────────────────────
function ouvrirFicheProjet(){
  document.getElementById('m-titre').value=P.titre||'';
  document.getElementById('m-sous').value=P.sousTitre||'';
  document.getElementById('m-auteur').value=P.auteur||'';
  document.getElementById('m-genre').value=P.genre||'';
  document.getElementById('m-annee').value=P.annee||'';
  document.getElementById('m-syn').value=P.synopsis||'';
  document.getElementById('modal-bg').classList.add('on');
  setTimeout(()=>document.getElementById('m-titre').focus(),50);
}
function fermerModal(){ document.getElementById('modal-bg')?.classList.remove('on'); }

function updateSbProjet(){
  document.getElementById('sbp-titre').textContent=P.titre||'Sans titre';
  document.getElementById('sbp-auteur').textContent=P.auteur||'';
  const meta=[P.genre,P.annee].filter(Boolean).join(' · ');
  document.getElementById('sbp-meta').textContent=meta;
  document.getElementById('s-titre').textContent=P.titre||'';
}

// ── Formatage texte ───────────────────────────────────────
function alignerTexte(align){
  document.execCommand('justify' + align.charAt(0).toUpperCase() + align.slice(1), false, null);
  document.getElementById('editor').focus();
}

function fmt(cmd){ document.execCommand(cmd,false,null); document.getElementById('editor').focus(); }

// Nettoyer le HTML de l'éditeur (divs → p, texte brut → p)
function nettoyerEditeur(){
  const ed=document.getElementById('editor');
  if(!ed) return;
  const texte=ed.innerText;
  const paragraphes=texte.split(/\n{2,}/).map(p=>p.replace(/\n/g,' ').trim()).filter(Boolean);
  if(!paragraphes.length) return;
  ed.innerHTML=paragraphes.map(p=>`<p>${p}</p>`).join('');
  edChange();
  flash('Alinéas restaurés ✓');
}

// ── TEXTOS ────────────────────────────────────────────────
function insererTexto(cote){
  const nom=prompt('Prénom du personnage :','');
  if(nom===null) return;
  const nomFinal=nom.trim()||'Personnage';
  const ed=document.getElementById('editor');
  ed.focus();
  const bloc=document.createElement('div');
  bloc.className=`texto-bloc ${cote}`;
  bloc.setAttribute('data-texto',cote);
  bloc.setAttribute('data-nom',nomFinal);
  bloc.innerHTML=`<div class="texto-bulle">
    <div class="texto-nom" contenteditable="true" spellcheck="false">${nomFinal}</div>
    <div class="texto-msg" contenteditable="true" spellcheck="true">Message…</div>
    <div class="texto-controls">
      <button class="texto-ctrl-btn" id="btn-cote-${Date.now()}">⇄ Côté</button>
      <button class="texto-ctrl-btn" id="btn-del-${Date.now()}" style="color:var(--accent)">✕</button>
    </div>
  </div>
  <div class="texto-tag">${cote==='droite'?'##droite':'##gauche'}:${nomFinal}</div>`;
  bloc.querySelector('[id^=btn-cote]').addEventListener('mousedown', e=>{ e.preventDefault(); basculerCote(e.target); });
  bloc.querySelector('[id^=btn-del]').addEventListener('mousedown', e=>{ e.preventDefault(); bloc.remove(); edChange(); });
  bloc.querySelector('.texto-nom').addEventListener('input',e=>{
    const n=e.target.textContent.trim();
    bloc.setAttribute('data-nom',n);
    const c=bloc.getAttribute('data-texto');
    bloc.querySelector('.texto-tag').textContent=`${c==='droite'?'##droite':'##gauche'}:${n}`;
  });
  const sel=window.getSelection();
  if(sel.rangeCount){ const r=sel.getRangeAt(0); r.collapse(false); r.insertNode(bloc); }
  else ed.appendChild(bloc);
  const msg=bloc.querySelector('.texto-msg');
  msg.focus();
  const r=document.createRange(); r.selectNodeContents(msg); r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
  edChange();
}
function basculerCote(btn){
  const bloc=btn.closest('.texto-bloc');
  const c=bloc.getAttribute('data-texto');
  const n=c==='droite'?'gauche':'droite';
  bloc.className=`texto-bloc ${n}`; bloc.setAttribute('data-texto',n);
  bloc.querySelector('.texto-tag').textContent=`${n==='droite'?'##droite':'##gauche'}:${bloc.getAttribute('data-nom')}`;
  edChange();
}
function repairerTextos(){
  document.querySelectorAll('#editor .texto-bloc').forEach(bloc=>{
    const bulle = bloc.querySelector('.texto-bulle');
    if(!bulle) return;
    // Toujours supprimer les vieux controls (peuvent avoir onmousedown inline obsolète)
    bulle.querySelectorAll('.texto-controls').forEach(c=>c.remove());
    // Recréer avec addEventListener
    const ctrl = document.createElement('div');
    ctrl.className = 'texto-controls';
    const btnCote = document.createElement('button');
    btnCote.className = 'texto-ctrl-btn';
    btnCote.textContent = '⇄ Côté';
    btnCote.addEventListener('mousedown', e=>{ e.preventDefault(); basculerCote(btnCote); });
    const btnDel = document.createElement('button');
    btnDel.className = 'texto-ctrl-btn';
    btnDel.textContent = '✕';
    btnDel.style.color = 'var(--accent)';
    btnDel.addEventListener('mousedown', e=>{ e.preventDefault(); bloc.remove(); edChange(); });
    ctrl.appendChild(btnCote);
    ctrl.appendChild(btnDel);
    bulle.appendChild(ctrl);
  });
}

// ── Tiret cadratin + typo française ──────────────────────
function edKey(e){
  const sel=window.getSelection();
  if(!sel.rangeCount) return;
  const r=sel.getRangeAt(0);
  const n=r.startContainer;
  if(n.nodeType!==3) return;
  const t=n.textContent, p=r.startOffset;

  // Autocorrection
  appliquerAutocorrection(e);
  majusculeApresPoint(e);

  // Entrée → créer un nouveau <p> propre
  if(e.key==='Enter' && !e.shiftKey){
    e.preventDefault();
    document.execCommand('insertParagraph');
    // insertParagraph duplique le style du paragraphe quitté (ex: text-align:center
    // d'un "* * *" centré) sur le nouveau paragraphe — on le repasse à l'alignement
    // par défaut (justifié) pour que le texte suivant ne reste pas centré.
    const selApresEntree=window.getSelection();
    if(selApresEntree.rangeCount){
      let node=selApresEntree.getRangeAt(0).startContainer;
      if(node.nodeType===3) node=node.parentElement;
      const bloc=node?.closest?.('#editor > p, #editor > div');
      if(bloc && bloc.style.textAlign){
        bloc.style.textAlign='';
        if(!bloc.getAttribute('style')) bloc.removeAttribute('style');
      }
    }
    edChange(); return;
  }

  // -- + espace/entrée → tiret cadratin
  if((e.key===' '||e.key==='Enter') && p>=2 && t.slice(p-2,p)==='--'){
    e.preventDefault();
    const ins=e.key==='Enter'?'—':'—\u00A0';
    n.textContent=t.slice(0,p-2)+ins+t.slice(p);
    setCaret(n,p-2+ins.length);
    if(e.key==='Enter') document.execCommand('insertParagraph');
    const h=document.getElementById('ch');
    h.classList.add('on'); clearTimeout(h._t); h._t=setTimeout(()=>h.classList.remove('on'),1100);
    edChange(); return;
  }

  // Apostrophe droite → apostrophe courbe (typo française)
  if(e.key==="'"){
    e.preventDefault();
    n.textContent=t.slice(0,p)+'’'+t.slice(p);
    setCaret(n,p+1);
    edChange(); return;
  }

  // Trois points → points de suspension …
  if(e.key==='.' && p>=2 && t.slice(p-2,p)==='..'){
    e.preventDefault();
    n.textContent=t.slice(0,p-2)+'…'+t.slice(p);
    setCaret(n,p-1);
    edChange(); return;
  }

  // Correction automatique : d'ou → d'où
  if([' ','\u00a0',',','.',';',':','?','!'].includes(e.key)){
    const avant=t.slice(0,p);
    const corrections=[["d'ou","d'où"],["D'ou","D'où"],["d\u2019ou","d\u2019où"],["D\u2019ou","D\u2019où"],["jusqu'ou","jusqu'où"],["Jusqu'ou","Jusqu'où"]];
    for(const [de,vers] of corrections){
      if(avant.length>=de.length && avant.endsWith(de)){
        e.preventDefault();
        const ins = [' ','\u00a0'].includes(e.key) ? ' ' : e.key;
        n.textContent=t.slice(0,p-de.length)+vers+ins+t.slice(p);
        setCaret(n,p-de.length+vers.length+ins.length);
        edChange(); return;
      }
    }
  }

  // Guillemets automatiques " → « » avec espaces fines insécables
  if(e.key==='"'){
    e.preventDefault();
    const avant = t.slice(0, p);
    const ouvert = (avant.match(/«/g)||[]).length > (avant.match(/»/g)||[]).length;
    if(ouvert){
      const ins = '\u202f»'; // espace fine insécable avant »
      n.textContent = t.slice(0,p) + ins + t.slice(p);
      setCaret(n, p + ins.length);
    } else {
      const ins = '«\u202f'; // espace fine insécable après «
      n.textContent = t.slice(0,p) + ins + t.slice(p);
      setCaret(n, p + ins.length);
    }
    edChange(); return;
  }

  // coeur → cœur, soeur → sœur, oeuf → œuf (après espace)
  if([' ','\u00a0',',','.'].includes(e.key)){
    const avant=t.slice(0,p);
    const ligs=[['coeur','cœur'],['Coeur','Cœur'],['soeur','sœur'],['Soeur','Sœur'],['oeuf','œuf'],['Oeuf','Œuf'],['oeil','œil'],['Oeil','Œil'],['oeuvre','œuvre'],['Oeuvre','Œuvre']];
    for(const [de,vers] of ligs){
      if(avant.endsWith(de)){
        e.preventDefault();
        const ins = e.key===' '||e.key==='\u00a0' ? '\u00a0' : e.key;
        n.textContent=t.slice(0,p-de.length)+vers+ins+t.slice(p);
        setCaret(n,p-de.length+vers.length+1);
        edChange(); return;
      }
    }
  }

  // Frappe de :;?!» → insérer espace fine insécable AVANT si le char précédent n'en est pas déjà une
  if(':;?!»'.includes(e.key)){
    const prev=t[p-1];
    if(prev && prev!=='\u202F' && prev!=='\u00A0' && prev!==' '){
      e.preventDefault();
      n.textContent=t.slice(0,p)+'\u202F'+e.key+t.slice(p);
      setCaret(n,p+2); edChange(); return;
    }
  }

  // Frappe de « → insérer le guillemet puis espace fine insécable après
  if(e.key==='«'){
    e.preventDefault();
    n.textContent=t.slice(0,p)+'«\u202F'+t.slice(p);
    setCaret(n,p+2); edChange(); return;
  }
}

function setCaret(node,pos){
  const nr=document.createRange();
  nr.setStart(node,Math.min(pos,node.textContent.length));
  nr.collapse(true);
  const sel=window.getSelection();
  sel.removeAllRanges(); sel.addRange(nr);
}

// ── Chapitres ─────────────────────────────────────────────
function renderSidebar(){
  const L=document.getElementById('chap-list'); L.innerHTML='';
  let currentSection = null;
  let sectionCollapsed = false;

  P.chapitres.forEach((c,i)=>{
    const niv=c.niveau||2;
    const d=document.createElement('div');

    if(niv===1){
      const isCollapsed = c._collapsed || false;
      d.className='ci niveau1'+(isCollapsed?' collapsed':'')+(i===chapI?' on':'');
      d.innerHTML=`<span class="ci-arrow">▾</span><span class="ci-t">${c.titre||'Sans titre'}</span>`;
      // Flèche = replier/déplier
      d.querySelector('.ci-arrow').onclick=(e)=>{
        e.stopPropagation();
        c._collapsed = !c._collapsed;
        renderSidebar();
      };
      // Titre = ouvrir dans l'éditeur
      d.onclick=()=>{ save(); loadChap(i); };
      currentSection = i;
      sectionCollapsed = isCollapsed;
    } else {
      d.className='ci niveau2'+(i===chapI?' on':'')+(sectionCollapsed?' hidden':'');
      let auteurTag = '';
      if(P._collab){
        if(c.auteur_id === sbUser?.id){
          auteurTag = `<span title="Mon chapitre" style="font-size:10px;margin-left:4px">✎</span>`;
        } else if(c.auteur_id){
          const pseudo = window._pseudosCollabs?.[c.auteur_id] || '?';
          auteurTag = `<span title="Chapitre de ${pseudo}" style="font-size:9px;color:var(--ink4);margin-left:4px;opacity:.8">🔐</span>`;
        } else {
          auteurTag = `<span title="Non assigné — premier à écrire le revendique" style="font-size:9px;color:var(--ink4);margin-left:4px;opacity:.5">○</span>`;
        }
      }
      d.innerHTML=`<span class="ci-t">${c.titre||'Sans titre'}${auteurTag}</span><span class="ci-w">${c.mots||0}m</span>`;
      d.onclick=()=>{ save(); loadChap(i); };
    }

    d.oncontextmenu=(e)=>{
      e.preventDefault();
      const niv2=c.niveau||2;
      const label1 = niv2===1 ? '→ Convertir en chapitre (Titre 2)' : '→ Convertir en section (Titre 1)';
      const label2 = P.chapitres.length>1 ? `Supprimer "${c.titre}"` : null;
      if(confirm(label1+(label2?'\n\nAnnuler = '+label2:''))){
        P.chapitres[i].niveau = niv2===1?2:1;
        renderSidebar();
      } else if(label2 && P.chapitres.length>1){
        if(confirm(`Supprimer "${c.titre}" ?`)){
          const chapId=c.id;
          // Sauvegarder le chapitre actif AVANT le splice pour ne pas perdre son contenu
          if(chapI !== i) save();
          P.chapitres.splice(i,1);
          if(!P._chapsSupprimés) P._chapsSupprimés=[];
          P._chapsSupprimés.push(chapId);
          // Ajuster chapI si le chapitre supprimé était avant ou était le courant
          if(i < chapI) chapI--;
          else if(i === chapI) chapI = Math.min(chapI, P.chapitres.length-1);
          loadChap(chapI);
          save();
          // Supprimer aussi dans Supabase
          if(P.projet_cloud_id && sb){
            sb.from('chapitres').delete()
              .eq('projet_id', P.projet_cloud_id)
              .eq('chapitre_id', chapId)
              .then(({error})=>{ if(error) console.warn('Erreur suppression chapitre cloud:', error.message); });
          }
          loadChap(chapI);
          renderSidebar();
        }
      }
    };
    L.appendChild(d);
  });
}

function loadChap(i){
  if(planMode){ planMode=false; document.getElementById('plan-view')?.classList.remove('on'); }
  fermerCarnetPage();
  if(carnetMode){ carnetMode=false; }
  document.getElementById('dashboard')?.classList.remove('on');
  // Libérer l'ancien verrou, poser le nouveau
  if(P.chapitres[chapI]?.id && P.chapitres[chapI].id !== P.chapitres[i]?.id){
    libererVerrou(P.chapitres[chapI].id);
  }
  if(P.chapitres[i]?.id) poserVerrou(P.chapitres[i].id);
  document.getElementById('es').style.display='block';
  document.getElementById('fmt-bar').style.display='flex';
  setNavActive(null);
  chapI=i; const c=P.chapitres[i];

  // Verrouiller le chapitre en lecture seule si :
  //   (a) il appartient à un autre auteur (auteur_id permanent), OU
  //   (b) quelqu'un d'autre est en train d'écrire dessus (verrou de session)
  const ed = document.getElementById('editor');
  const verrouxSession = _verrouxAutres?.[c.id];
  const bloqueParAuteur  = c.auteur_id && c.auteur_id !== sbUser?.id;
  const bloqueParSession = verrouxSession && verrouxSession.user_id !== sbUser?.id;
  const estMonChap = !bloqueParAuteur && !bloqueParSession;
  ed.contentEditable = estMonChap ? 'true' : 'false';
  ed.style.opacity = estMonChap ? '' : '0.65';
  ed.title = bloqueParSession
    ? `${verrouxSession.pseudo} est en train d'écrire ici…`
    : bloqueParAuteur
      ? 'Chapitre en lecture seule — appartient à un autre auteur'
      : '';
  document.getElementById('fmt-bar').style.opacity = estMonChap ? '' : '0.3';
  document.getElementById('fmt-bar').style.pointerEvents = estMonChap ? '' : 'none';

  document.getElementById('editor').innerHTML=c.contenu||'';
  // Garder ch.mots depuis projets.contenu — fiable et cohérent avec la sidebar
  // Réparer le contenu fusionné par la migration ratée
  repairerContenu();
  // Reconstruire les contrôles des textos
  repairerTextos();
  document.getElementById('chap-ti').value=c.titre;
  document.getElementById('chap-n').textContent = (i+1)+'.';
  document.getElementById('s-chap').textContent=c.titre;
  // Scroll en haut sur changement de chapitre
  document.getElementById('ez')?.scrollTo(0,0);
  document.getElementById('editor')?.scrollTo(0,0);
  window.scrollTo(0,0);
  // Capturer le texte de référence pour détecter les vrais changements dans save()
  c._texteRef = (document.getElementById('editor').innerText || '').replace(/\s+/g, ' ').trim();
  c._dirty = false; // Chapitre vient d'être chargé — pas modifié
  updateWC(); renderSidebar(); ltLastText=''; ltSchedule();
  if(accOuvert==='notesChap') renderAcc('notesChap');
}

function repairerContenu(){
  const ed = document.getElementById('editor');
  const children = Array.from(ed.childNodes);
  // Détecter si tout est dans un seul noeud texte
  if(children.length === 1 && children[0].nodeType === 3){
    const txt = children[0].textContent;
    const paras = txt.split('\n').filter(s => s.trim());
    if(paras.length > 1){
      ed.innerHTML = paras.map(p => `<div>${p}</div>`).join('');
      // Mettre à jour P.chapitres aussi pour que l'export soit correct
      P.chapitres[chapI].contenu = ed.innerHTML;
    }
  }
  // Détecter un seul grand div avec tout dedans (migration ratée)
  if(children.length === 1 && children[0].nodeName === 'DIV'){
    const inner = children[0].innerHTML;
    // Si le div contient des &nbsp;&nbsp; ou beaucoup de texte sans sous-divs
    const subDivs = children[0].querySelectorAll('div, p').length;
    if(subDivs === 0 && inner.length > 200){
      const txt = children[0].innerText;
      const paras = txt.split('\n').filter(s => s.trim());
      if(paras.length > 1){
        ed.innerHTML = paras.map(p => `<div>${p}</div>`).join('');
        P.chapitres[chapI].contenu = ed.innerHTML;
      }
    }
  }
}



function save(){
  ltClearMarks();
  const c = P.chapitres[chapI];
  const t = document.getElementById('editor').innerText || '';
  const nouveauTexte = t.replace(/\s+/g, ' ').trim();

  // Ne rien changer si le texte n'a pas bougé
  if(c._texteRef === nouveauTexte){
    updateWC();
    return;
  }

  // Premier accès au chapitre (après changement de projet) — poser la référence sans marquer dirty
  if(c._texteRef === undefined){
    c._texteRef = nouveauTexte;
    updateWC();
    return;
  }

  // Le texte a changé — comptage absolu depuis le DOM
  c.contenu = document.getElementById('editor').innerHTML;
  c.mots = nouveauTexte ? nouveauTexte.split(/\s+/).length : 0;
  c._dirty = true;
  c._texteRef = nouveauTexte;
  updateWC();
  renderSidebar();
  // Backup local
  try {
    const key = `encre_backup_${P.projet_cloud_id||'local'}_ch${c.id}`;
    localStorage.setItem(key, JSON.stringify({
      contenu: c.contenu, mots: c.mots, titre: c.titre,
      ts: new Date().toISOString()
    }));
  } catch(e) {}
}

function totalMotsProjet(){
  return P.chapitres.reduce((s,c) => s + (c.mots||0), 0);
}

function verifierBackupLocal(){
  // Vérifie si un backup local est plus récent que la version cloud chargée
  try {
    P.chapitres.forEach((ch, i) => {
      // Ne pas proposer de restaurer les chapitres des autres
      if(ch.auteur_id && ch.auteur_id !== sbUser?.id) return;
      const key = `encre_backup_${P.projet_cloud_id||'local'}_ch${ch.id}`;
      const raw = localStorage.getItem(key);
      if(!raw) return;
      const backup = JSON.parse(raw);
      const backupTs = new Date(backup.ts);
      // Si le backup est récent (moins de 24h) et plus long que le contenu cloud
      const motsBackup = backup.mots || 0;
      const motsCloud = ch.mots || 0;
      if(motsBackup > motsCloud && (Date.now() - backupTs) < 86400000){
        if(confirm(`Backup local trouvé pour "${ch.titre}" : ${motsBackup} mots vs ${motsCloud} mots en cloud.\n\nRestaurer le backup local ?`)){
          P.chapitres[i].contenu = backup.contenu;
          P.chapitres[i].mots = backup.mots;
          P.chapitres[i]._dirty = true;
          if(chapI === i){
            document.getElementById('editor').innerHTML = backup.contenu;
            updateWC();
          }
          flash('Backup restauré ✓');
        }
        // Dans tous les cas (restauré ou refusé), effacer le backup pour ne plus afficher le popup
        try { localStorage.removeItem(key); } catch(e) {}
      }
    });
  } catch(e) {}
}

let _totalMotsDebutSession = null; // gardé pour compatibilité

// Stats gérées dans stats.js (chargé séparément)
// Stub pour éviter les erreurs si stats.js n'est pas encore chargé
async function mettreAJourStatsJour(){
  if(typeof window._mettreAJourStatsJour === 'function'){
    return window._mettreAJourStatsJour();
  }
}

function ajouterChap(){
  save();
  const newChap = {id: P.nid++, titre: 'Chapitre '+(P.chapitres.length+1), contenu:'<p><br></p>', mots:0, niveau:2, _dirty:true, auteur_id: sbUser?.id||null};
  P.chapitres.push(newChap);
  loadChap(P.chapitres.length-1);
  // Sauvegarder immédiatement dans le cloud pour ne jamais perdre le nouveau chapitre
  if(P.projet_cloud_id){
    sauvegarderCloud();
  }
}

function titreChap(v){ P.chapitres[chapI].titre=v; renderSidebar(); document.getElementById('s-chap').textContent=v; }

function edChange(){
  const ch = P.chapitres[chapI];
  if(ch?.auteur_id && ch.auteur_id !== sbUser?.id){
    // Annuler — remettre le contenu original
    document.getElementById('editor').innerHTML = ch.contenu || '';
    return;
  }
  // Premier qui écrit dans un chapitre sans auteur → le chapitre lui appartient
  if(!ch.auteur_id && sbUser?.id && P._collab){
    ch.auteur_id = sbUser.id;
    ch._dirty = true;
    // Mettre à jour _mesChapitres
    if(!P._mesChapitres) P._mesChapitres = [];
    if(!P._mesChapitres.includes(ch.id)) P._mesChapitres.push(ch.id);
    renderSidebar();
  }
  save(); updateWC(); setSaveStatus('pending');
  // Garder le curseur visible avec de l'espace sous lui
  const sel = window.getSelection();
  if(sel?.rangeCount){
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const container = document.getElementById('es');
    if(container && rect.bottom > window.innerHeight * 0.72){
      container.scrollBy({ top: rect.bottom - window.innerHeight * 0.52, behavior: 'smooth' });
    }
  }
}


// ── Typographie française (nettoyage à l'export) ───────────
// Filet de sécurité pour le texte collé/importé qui n'est pas passé par edKey() :
// apostrophes courbes, points de suspension, espaces insécables avant ; : ! ? »
function normaliserTypoTexte(s){
  return s
    .replace(/'/g, '’')
    .replace(/\.{3,}/g, '…')
    .replace(/[  ]([;:!?])/g, ' $1')
    .replace(/[  ]»/g, ' »')
    .replace(/« [  ]?/g, '« ');
}
function normaliserTypoNode(root){
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(node => { node.textContent = normaliserTypoTexte(node.textContent); });
}

// ── AUTOCORRECTION ────────────────────────────────────────
const CORRECTIONS_FIXES = {
  'poru':'pour','poru ':'pour ','avce':'avec','teh':'the',
  'pius':'puis','jsuis':'je suis','cest':'c\'est',
  'jcois':'je crois','jai':'j\'ai',
  'ect':'etc','qque':'quelque','qqe':'quelque',
  'tt':'tout','tjrs':'toujours','bcp':'beaucoup',
  'pcq':'parce que','pck':'parce que','dsl':'désolé',
  'nv':'nouveau','nvx':'nouveaux','ms':'mais',
  'ss':'sans','dc':'donc','pk':'pourquoi',
  'vs':'vous','ns':'nous','vl':'vouloir',
  'avc':'avec','pr':'pour','qd':'quand',
};

// Charger corrections perso depuis localStorage
function getCorrectionsPerso(){
  try{ return JSON.parse(localStorage.getItem('encre_corrections')||'{}'); }
  catch(e){ return {}; }
}
function sauverCorrectionsPerso(obj){
  localStorage.setItem('encre_corrections', JSON.stringify(obj));
}

function appliquerAutocorrection(e){
  // Seulement sur espace, ponctuation
  if(![' ',',','.',"!",'?',';',':',"'"].includes(e.key)) return;
  const sel = window.getSelection();
  if(!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if(node.nodeType !== 3) return;
  const txt = node.textContent;
  const pos = range.startOffset;
  // Extraire le dernier mot
  const avant = txt.substring(0, pos);
  const m = avant.match(/(\S+)$/);
  if(!m) return;
  const mot = m[1].toLowerCase();
  const corrections = {...CORRECTIONS_FIXES, ...getCorrectionsPerso()};
  if(corrections[mot]){
    const remplacement = corrections[mot];
    const start = pos - m[1].length;
    node.textContent = txt.substring(0, start) + remplacement + txt.substring(pos);
    const newRange = document.createRange();
    newRange.setStart(node, start + remplacement.length);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
}

function majusculeApresPoint(e){
  if(e.key !== ' ') return;
  const sel = window.getSelection();
  if(!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if(node.nodeType !== 3) return;
  const txt = node.textContent;
  const pos = range.startOffset;
  const avant = txt.substring(0, pos).trimEnd();
  // Ne pas majusculer après ... ou … (points de suspension)
  if(/\.{2,}$/.test(avant) || avant.endsWith('…')) return;
  // Ne pas majusculer si le point fait partie de "... mot" ou "…mot"
  const m = avant.match(/([.!?])\s+(\p{Ll}+)$/u);
  if(!m) return;
  // Vérifier que le point n'est pas précédé d'autres points
  const idxPoint = avant.lastIndexOf(m[1]);
  if(idxPoint > 0 && avant[idxPoint-1] === '.') return;
  const motStart = avant.lastIndexOf(m[2]);
  node.textContent = txt.substring(0, motStart) +
    m[2].charAt(0).toUpperCase() + m[2].slice(1) +
    txt.substring(motStart + m[2].length);
  const newRange = document.createRange();
  newRange.setStart(node, pos);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

function ouvrirModalCorrections(){
  const perso = getCorrectionsPerso();
  const items = Object.entries(perso).map(([k,v])=>
    `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <code style="background:var(--paper3);padding:2px 6px;border-radius:3px;font-size:13px;">${k}</code>
      <span style="color:var(--ink4)">→</span>
      <code style="background:var(--paper3);padding:2px 6px;border-radius:3px;font-size:13px;">${v}</code>
      <button onclick="supprimerCorrection('${k}')" style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:12px;margin-left:auto">✕</button>
    </div>`
  ).join('');

  document.getElementById('modal-bg').classList.add('on');
  document.getElementById('modal').innerHTML = `
    <h3>Mes corrections</h3>
    <p style="font-family:'Crimson Pro',serif;font-size:14px;color:var(--ink4);margin-bottom:16px">Les mots sont corrigés automatiquement quand tu appuies sur espace.</p>
    <div id="corrections-liste" style="margin-bottom:16px;max-height:200px;overflow-y:auto">${items||'<div style="color:var(--ink4);font-size:13px;font-style:italic">Aucune correction personnalisée.</div>'}</div>
    <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center;margin-bottom:12px;width:100%;">
      <input id="corr-de" placeholder="Faute (ex: teh)" style="font-family:'Crimson Pro',serif;font-size:15px;padding:6px 8px;border:1px solid var(--paper3);border-radius:4px;background:var(--paper2);min-width:0;">
      <span style="color:var(--ink4);text-align:center">→</span>
      <input id="corr-vers" placeholder="Correction (ex: the)" style="font-family:'Crimson Pro',serif;font-size:15px;padding:6px 8px;border:1px solid var(--paper3);border-radius:4px;background:var(--paper2);min-width:0;">
    </div>
    <div class="fbr">
      <button class="fb fb-s" onclick="ajouterCorrection()">Ajouter</button>
      <button class="fb fb-c" onclick="fermerModal()">Fermer</button>
    </div>`;
}

function ajouterCorrection(){
  const de = document.getElementById('corr-de').value.trim().toLowerCase();
  const vers = document.getElementById('corr-vers').value.trim();
  if(!de||!vers) return;
  const perso = getCorrectionsPerso();
  perso[de] = vers;
  sauverCorrectionsPerso(perso);
  ouvrirModalCorrections();
}

function supprimerCorrection(mot){
  const perso = getCorrectionsPerso();
  delete perso[mot];
  sauverCorrectionsPerso(perso);
  ouvrirModalCorrections();
}
let ltIgnored = new Set();
let ltMatches = [];

function ltSchedule(){ /* LT manuel uniquement */ }

async function ltTogglePanel(){
  const body = document.getElementById('acc-lt');
  const arrow = document.getElementById('arr-lt');
  const isOpen = body.style.display !== 'none';
  if(isOpen){
    body.style.display = 'none';
    arrow.textContent = '▸';
    ltClearHighlight();
  } else {
    body.style.display = 'flex';
    arrow.textContent = '▾';
    await ltOuvrirPanel();
  }
}

async function ltOuvrirPanel(){
  const list = document.getElementById('lt-panel-list');
  list.innerHTML = '<div style="padding:10px 14px;font-family:\'Crimson Pro\',serif;font-size:13px;color:var(--ink4);font-style:italic">Analyse…</div>';
  setLtStatus('checking');

  const ed = document.getElementById('editor');
  const text = ed.innerText.trim();
  if(text.length < 3){ list.innerHTML = '<div style="padding:10px 14px;font-size:13px;color:var(--ink4);font-family:\'Crimson Pro\',serif;font-style:italic">Rien à analyser.</div>'; return; }

  try {
    const res = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        language: 'fr', text,
        disabledCategories: 'STYLE,PUNCTUATION,CASING,REDUNDANCY,COLLOQUIALISMS',
        disabledRules: 'WHITESPACE_RULE,CONSECUTIVE_SPACES,FRENCH_WHITESPACE,TOO_LONG_SENTENCE,UPPERCASE_SENTENCE_START,WORD_REPEAT_RULE,FR_AGREEMENT_POSTPONED_VERB,ACCORD_SUJET_VERBE'
      })
    });
    const data = await res.json();
    ltMatches = (data.matches||[]).filter(m=>!ltIgnored.has(m.message));
    ltRenderPanel();
    setLtStatus('ok');
  } catch(e){
    list.innerHTML = '<div style="padding:10px 14px;font-size:13px;color:var(--accent);font-family:\'Crimson Pro\',serif">Indisponible.</div>';
    setLtStatus('offline');
  }
}

function ltRenderPanel(){
  const list = document.getElementById('lt-panel-list');
  const n = ltMatches.length;
  // lt-status retiré de l'interface
  if(!n){
    list.innerHTML = '<div style="padding:12px 14px;font-family:\'Crimson Pro\',serif;font-size:14px;color:#4a8050;font-style:italic">✓ Aucune erreur !</div>';
    return;
  }
  list.innerHTML = '';
  ltMatches.forEach((m, idx) => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:8px 12px;border-bottom:1px solid var(--paper3);cursor:pointer;transition:background .1s;';
    item.onmouseenter = ()=>{ item.style.background='var(--paper3)'; };
    item.onmouseleave = ()=>{ item.style.background=''; };
    const ctx = m.context?.text||'';
    const co = m.context?.offset||0;
    const cl = m.context?.length||0;
    const mot = ctx.slice(co, co+cl);
    item.innerHTML = `
      <div onclick="ltSurligner(${idx})" style="font-family:'Crimson Pro',serif;font-size:14px;color:var(--ink);margin-bottom:3px;">
        <span style="color:var(--accent);font-style:italic">${mot}</span>
        <span style="color:var(--ink4);font-size:12px;"> — ${m.message.length>60?m.message.substring(0,60)+'…':m.message}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px;">
        <span style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ink4)">→</span>
        ${(m.replacements||[]).slice(0,3).map(r=>`<span onclick="ltAppliquer(${idx},'${r.value.replace(/'/g,"\\'")}')" style="font-family:'Crimson Pro',serif;font-size:13px;background:var(--paper2);border:1px solid var(--paper3);border-radius:3px;padding:1px 7px;cursor:pointer;color:var(--ink)">${r.value}</span>`).join('')}
        <span onclick="ltIgnorer(${idx})" style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ink4);cursor:pointer;margin-left:4px;text-decoration:underline">ignorer</span>
      </div>`;
    list.appendChild(item);
  });
}

// Surligner le mot dans l'éditeur
let ltHighlightEl = null;
function ltSurligner(idx){
  ltClearHighlight();
  const m = ltMatches[idx];
  if(!m) return;

  const ed = document.getElementById('editor');
  let pos = 0, found = false;

  function walk(node){
    if(found) return;
    if(node.nodeType === 3){
      const len = node.textContent.length;
      if(pos <= m.offset && m.offset + m.length <= pos + len){
        const localStart = m.offset - pos;
        const localEnd = localStart + m.length;
        const txt = node.textContent;
        const span = document.createElement('span');
        span.className = 'lt-highlight';
        span.textContent = txt.slice(localStart, localEnd);
        const after = document.createTextNode(txt.slice(localEnd));
        node.textContent = txt.slice(0, localStart);
        node.parentNode.insertBefore(span, node.nextSibling);
        node.parentNode.insertBefore(after, span.nextSibling);
        span.scrollIntoView({ behavior:'smooth', block:'center' });
        ltHighlightEl = span;
        found = true;
        return;
      }
      pos += len;
    } else if(node.nodeType === 1){
      if(['P','DIV'].includes(node.nodeName) && pos > 0) pos += 2;
      node.childNodes.forEach(walk);
    }
  }
  walk(ed);
}

function ltClearHighlight(){
  if(ltHighlightEl){
    const txt = document.createTextNode(ltHighlightEl.textContent);
    ltHighlightEl.parentNode.replaceChild(txt, ltHighlightEl);
    document.getElementById('editor').normalize();
    ltHighlightEl = null;
  }
}

function ltAppliquer(idx, remplacement){
  ltClearHighlight();
  const m = ltMatches[idx];
  if(!m) return;
  const ed = document.getElementById('editor');
  let pos = 0, found = false;
  function walk(node){
    if(found) return;
    if(node.nodeType === 3){
      const len = node.textContent.length;
      if(pos <= m.offset && m.offset + m.length <= pos + len){
        const localStart = m.offset - pos;
        const localEnd = localStart + m.length;
        const txt = node.textContent;
        node.textContent = txt.slice(0, localStart) + remplacement + txt.slice(localEnd);
        found = true; return;
      }
      pos += len;
    } else if(node.nodeType === 1){
      if(['P','DIV'].includes(node.nodeName) && pos > 0) pos += 2;
      node.childNodes.forEach(walk);
    }
  }
  walk(ed);
  const diff = remplacement.length - m.length;
  ltMatches.splice(idx, 1);
  ltMatches.forEach(mm => { if(mm.offset > m.offset) mm.offset += diff; });
  ltRenderPanel();
  edChange();
}

function ltIgnorer(idx){
  if(ltMatches[idx]) ltIgnored.add(ltMatches[idx].message);
  ltMatches.splice(idx, 1);
  ltRenderPanel();
}

function ltFermerPanel(){ /* plus nécessaire */ }

function ltClearMarks(){
  const ed = document.getElementById('editor');
  if(!ed) return;
  ed.querySelectorAll('.lt-err,.lt-highlight').forEach(span=>{
    span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
  });
  ed.normalize();
}

function updateWC(){
  const ed = document.getElementById('editor');
  const t = ed ? ed.innerText : '';
  const m = t.trim() ? t.trim().split(/\s+/).length : 0;
  document.getElementById('wc').textContent = m + ' mots';
  // c.mots est géré par save() via delta — ne pas écraser ici
  // Total : chapitre actif depuis DOM (affichage live), autres depuis P.chapitres
  const tot = P.chapitres.reduce((s,c,idx) => s + (idx===chapI ? m : (c.mots||0)), 0);
  document.getElementById('s-total').textContent = tot + ' mots';
  document.getElementById('sb-total-mots').textContent = tot.toLocaleString('fr-FR') + ' mots';
}

// ── Vue Plan ─────────────────────────────────────────────
let planMode=false, planTabA='fiches', carnetMode=false, carnetActif=null;

function togglePlan(){
  if(carnetMode){ carnetMode=false; }
  fermerCarnetPage();
  planMode=!planMode;
  save();
  document.getElementById('es').style.display=planMode?'none':'block';
  document.getElementById('fmt-bar').style.display=planMode?'none':'flex';
  document.getElementById('plan-view').classList.toggle('on',planMode);
  setNavActive(planMode?'nav-plan':null);
  if(planMode){ planTab(planTabA, document.querySelector('.plan-tab.on')||document.querySelector('.plan-tab')); }
}

function planTab(which, btn){
  planTabA=which;
  document.querySelectorAll('.plan-tab').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  document.getElementById('plan-grid').style.display=which==='fiches'?'grid':'none';
  document.getElementById('plan-notes').style.display=which==='notes'?'block':'none';
  document.getElementById('plan-struct').style.display=which==='struct'?'block':'none';
  document.getElementById('plan-etapes').style.display=which==='etapes'?'block':'none';
  if(which==='fiches') renderPlan();
  else if(which==='notes') renderPlanNotes();
  else if(which==='etapes') renderEtapes();
  else renderPlanStruct();
}

function renderPlan(){
  const grid=document.getElementById('plan-grid');
  grid.innerHTML='';
  P.chapitres.forEach((ch,i)=>{
    const f=document.createElement('div');
    f.className='fiche'; f.draggable=true; f.dataset.i=i;
    const st=ch.statut||'brouillon';
    f.innerHTML=`<div class="fiche-num">Chapitre ${i+1}</div>
      <div class="fiche-titre" contenteditable="true" spellcheck="false">${ch.titre||''}</div>
      <div class="fiche-resume" contenteditable="true" spellcheck="false">${ch.resume||''}</div>
      <div class="fiche-footer">
        <span class="fiche-mots">${ch.mots||0} mots</span>
        <select class="fiche-statut st-${st}" onchange="setStatut(${i},this)">
          <option value="brouillon" ${st==='brouillon'?'selected':''}>Brouillon</option>
          <option value="reviser" ${st==='reviser'?'selected':''}>À revoir</option>
          <option value="final" ${st==='final'?'selected':''}>Final</option>
        </select>
      </div>`;
    f.querySelector('.fiche-titre').addEventListener('blur',e=>{ P.chapitres[i].titre=e.target.innerText.trim(); renderSidebar(); });
    f.querySelector('.fiche-resume').addEventListener('blur',e=>{ P.chapitres[i].resume=e.target.innerHTML; });
    f.addEventListener('dblclick',()=>{ togglePlan(); save(); loadChap(i); });
    f.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain',i); f.classList.add('dragging'); });
    f.addEventListener('dragend',()=>{ f.classList.remove('dragging'); document.querySelectorAll('.fiche').forEach(x=>x.classList.remove('drag-over')); });
    f.addEventListener('dragover',e=>{ e.preventDefault(); f.classList.add('drag-over'); });
    f.addEventListener('dragleave',()=>f.classList.remove('drag-over'));
    f.addEventListener('drop',e=>{ e.preventDefault(); f.classList.remove('drag-over'); const from=parseInt(e.dataTransfer.getData('text/plain')); const to=parseInt(f.dataset.i); if(from===to)return; const ch=P.chapitres.splice(from,1)[0]; P.chapitres.splice(to,0,ch); renderPlan(); renderSidebar(); });
    grid.appendChild(f);
  });
  const add=document.createElement('div'); add.className='plan-add'; add.textContent='+'; add.title='Nouveau chapitre';
  add.onclick=()=>{ ajouterChap(); renderPlan(); };
  grid.appendChild(add);
}

function setStatut(i,sel){ P.chapitres[i].statut=sel.value; sel.className='fiche-statut st-'+sel.value; }

function renderPlanNotes(){
  const ed=document.getElementById('plan-notes-ed');
  ed.innerHTML=P.planNotes||'';
}

function renderPlanStruct(){
  const c=document.getElementById('plan-struct');
  if(!P.struct) P.struct={};
  const ACTES=[
    {id:'a1',label:'Acte I — Mise en place',sub:'Présentation du monde, du protagoniste et du déclencheur',
     blocs:[{id:'monde',label:'Le monde ordinaire',ph:'Comment est la vie du protagoniste avant tout ?'},
            {id:'decl',label:'Élément déclencheur',ph:'Quel événement brise l\'équilibre initial ?'},
            {id:'refus',label:'Refus de l\'appel',ph:'Pourquoi hésite-t-il à s\'engager ?'},
            {id:'mentor',label:'Rencontre / mentor',ph:'Qui l\'aide à franchir le seuil ?'}]},
    {id:'a2a',label:'Acte II-A — Confrontation',sub:'Le protagoniste entre dans un nouveau monde et affronte des épreuves',
     blocs:[{id:'seuil',label:'Franchissement du seuil',ph:'Il s\'engage — qu\'est-ce qui change ?'},
            {id:'allies',label:'Alliés & ennemis',ph:'Qui rencontre-t-il ? Qui est de quel côté ?'},
            {id:'epreuves',label:'Épreuves & obstacles',ph:'Quelles difficultés croissantes ?'},
            {id:'cave',label:'Approche de la caverne',ph:'Le plus grand danger approche — quelle préparation ?'}]},
    {id:'mid',label:'Midpoint',sub:'Faux triomphe ou fausse défaite — tout bascule ici',
     blocs:[{id:'midpt',label:'Point médian',ph:'Quelle révélation ou retournement à mi-chemin ?'}]},
    {id:'a2b',label:'Acte II-B — Transformation',sub:'Tout s\'effondre, mais le protagoniste se transforme',
     blocs:[{id:'epreuve',label:'Épreuve centrale',ph:'La pire épreuve — mort symbolique ou réelle ?'},
            {id:'recomp',label:'Récompense',ph:'Ce qu\'il obtient en survivant à l\'épreuve'},
            {id:'route',label:'Le chemin du retour',ph:'Décision de revenir ou de terminer la quête'}]},
    {id:'a3',label:'Acte III — Résolution',sub:'Climax et nouveau monde',
     blocs:[{id:'resurr',label:'Résurrection',ph:'Dernier obstacle — transformation définitive'},
            {id:'climax',label:'Climax',ph:'L\'affrontement final — comment se résout-il ?'},
            {id:'retour',label:'Retour avec l\'élixir',ph:'Qu\'est-ce qui a changé ? Quel est le monde nouveau ?'}]}
  ];
  c.innerHTML='';
  ACTES.forEach((acte,ai)=>{
    const div=document.createElement('div'); div.className='struct-acte';
    div.innerHTML=`<div class="struct-acte-titre"><span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ink4)">${ai+1}</span>${acte.label}</div>
      <div class="struct-acte-sub">${acte.sub}</div>`;
    acte.blocs.forEach(b=>{
      const bd=document.createElement('div'); bd.className='struct-block';
      const val=P.struct[b.id]||'';
      bd.innerHTML=`<div class="struct-block-label">${b.label}</div>
        <textarea placeholder="${b.ph}" oninput="P.struct['${b.id}']=this.value">${val}</textarea>`;
      div.appendChild(bd);
    });
    c.appendChild(div);
    if(ai<ACTES.length-1){
      const sep=document.createElement('div'); sep.className='struct-divider';
      c.appendChild(sep);
    }
  });
}


// ── Recherche dans tous les chapitres ────────────────────
let _searchTimeout = null;
function rechercherDansChapitres(query){
  clearTimeout(_searchTimeout);
  const results = document.getElementById('search-results');
  if(!results) return;
  if(!query || query.length < 2){ results.innerHTML = ''; return; }

  _searchTimeout = setTimeout(() => {
    const q = query.toLowerCase();
    const hits = [];

    P.chapitres.forEach((ch, idx) => {
      if(!ch.contenu) return;
      // Extraire le texte brut du HTML
      const div = document.createElement('div');
      div.innerHTML = ch.contenu;
      const txt = div.innerText || '';
      const lower = txt.toLowerCase();
      let pos = lower.indexOf(q);
      let count = 0;
      const extraits = [];

      while(pos !== -1 && count < 3){
        // Extrait de ~60 caractères autour du résultat
        const debut = Math.max(0, pos - 30);
        const fin = Math.min(txt.length, pos + q.length + 30);
        let extrait = (debut > 0 ? '…' : '') + txt.substring(debut, fin) + (fin < txt.length ? '…' : '');
        // Mettre en gras le terme trouvé
        const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        extrait = extrait.replace(re, '<strong style="color:var(--accent)">$&</strong>');
        extraits.push(extrait);
        count++;
        pos = lower.indexOf(q, pos + q.length);
      }

      // Compter toutes les occurrences
      let total = 0;
      let p = lower.indexOf(q);
      while(p !== -1){ total++; p = lower.indexOf(q, p + 1); }

      if(total > 0){
        hits.push({ idx, titre: ch.titre || 'Sans titre', extraits, total });
      }
    });

    if(hits.length === 0){
      results.innerHTML = '<div style="font-family:\'Crimson Pro\',serif;font-size:12px;color:var(--ink4);padding:4px 0;">Aucun résultat.</div>';
      return;
    }

    results.innerHTML = hits.map(h =>
      `<div style="padding:6px 0;border-bottom:1px solid var(--paper3,#e8e0d4);cursor:pointer;" onclick="loadChap(${h.idx})">
        <div style="font-family:'Crimson Pro',serif;font-size:13px;font-weight:600;color:var(--ink);">${h.titre} <span style="font-size:10px;color:var(--ink4);font-weight:normal;">(${h.total})</span></div>
        ${h.extraits.map(e => '<div style="font-size:11px;color:var(--ink3);margin-top:2px;line-height:1.4;">' + e + '</div>').join('')}
      </div>`
    ).join('');
  }, 300); // Debounce 300ms
}

// ── Étapes du projet ──────────────────────────────────────
const ETAPES_PREDEFINIES = [
  { id: 'debut',      label: 'Début d\'écriture',    icone: '✏️' },
  { id: 'premier_jet',label: 'Premier jet terminé',  icone: '📝' },
  { id: 'revision',   label: 'Révision',             icone: '🔍' },
  { id: 'correction', label: 'Correction',           icone: '✂️' },
  { id: 'beta',       label: 'Bêta-lecture',         icone: '👥' },
  { id: 'final',      label: 'Version finale',       icone: '🎉' },
];

function renderEtapes(){
  if(!P.etapes) P.etapes = {};
  const c = document.getElementById('plan-etapes');
  const total = P.chapitres.reduce((s, ch) => s + (ch.mots||0), 0);

  let html = `<div style="padding:16px 0;">
    <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ink4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px;">Parcours du projet · ${total.toLocaleString('fr-FR')} mots</div>
    <div style="position:relative;padding-left:32px;">
      <div style="position:absolute;left:14px;top:4px;bottom:4px;width:2px;background:var(--paper3);"></div>`;

  ETAPES_PREDEFINIES.forEach((et, i) => {
    const date = P.etapes[et.id] || '';
    const fait = !!date;
    const couleur = fait ? 'var(--gold)' : 'var(--paper3)';
    const opacite = fait ? '1' : '0.5';

    html += `
      <div style="position:relative;margin-bottom:20px;opacity:${opacite};">
        <div style="position:absolute;left:-24px;top:2px;width:18px;height:18px;border-radius:50%;background:${couleur};display:flex;align-items:center;justify-content:center;font-size:10px;border:2px solid ${fait ? 'var(--gold)' : 'var(--paper3)'};">${fait ? '✓' : (i+1)}</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="font-size:15px;">${et.icone}</span>
          <span style="font-family:'Crimson Pro',serif;font-size:16px;font-weight:600;color:var(--ink);">${et.label}</span>
          <input type="date" value="${date}" 
            onchange="P.etapes['${et.id}']=this.value; renderEtapes();"
            style="font-family:'JetBrains Mono',monospace;font-size:11px;padding:3px 8px;border:1px solid var(--paper3);border-radius:4px;background:var(--paper);color:var(--ink3);cursor:pointer;">
          <button onclick="P.etapes['${et.id}']=aujourdhui(); renderEtapes();"
            style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:3px 10px;border:1px solid var(--paper3);border-radius:4px;background:none;color:var(--ink4);cursor:pointer;"
            title="Marquer aujourd'hui">Aujourd'hui</button>
          ${fait ? `<button onclick="delete P.etapes['${et.id}']; renderEtapes();"
            style="font-family:'JetBrains Mono',monospace;font-size:10px;padding:3px 8px;border:none;background:none;color:var(--ink4);cursor:pointer;"
            title="Retirer la date">✕</button>` : ''}
        </div>
        ${fait ? `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--ink4);margin-top:2px;">${new Date(date).toLocaleDateString('fr-CA', {day:'numeric', month:'long', year:'numeric'})}</div>` : ''}
      </div>`;
  });

  // Durée totale si début et dernière étape faite
  const debut = P.etapes.debut;
  const faites = ETAPES_PREDEFINIES.filter(e => P.etapes[e.id]);
  const derniere = faites.length ? faites[faites.length-1] : null;
  if(debut && derniere && derniere.id !== 'debut'){
    const j1 = new Date(debut);
    const j2 = new Date(P.etapes[derniere.id]);
    const diff = Math.ceil((j2 - j1) / (1000*60*60*24));
    html += `<div style="margin-top:12px;padding:10px 14px;background:var(--paper2);border-radius:6px;font-family:'Crimson Pro',serif;font-size:14px;color:var(--ink3);">
      ${debut} → ${P.etapes[derniere.id]} · <strong>${diff} jours</strong> (${derniere.label.toLowerCase()})
    </div>`;
  }

  html += '</div></div>';
  c.innerHTML = html;
}

// ── Carnet auteur ─────────────────────────────────────────
let CA = { idees:[], nid:1 };
let carnetFiInput=null;

function toggleCarnet(){ ouvrirCarnetPage(); }

function renderCarnetList(){
  const list=document.getElementById('carnet-list'); list.innerHTML='';
  const stLabel={germe:'Germe',dev:'En développement',ecrire:'À écrire'};
  CA.idees.forEach((id,i)=>{
    const d=document.createElement('div'); d.className='carnet-item'+(carnetActif===i?' on':'');
    const st=id.statut||'germe';
    d.innerHTML=`<div class="carnet-item-titre">${id.titre||'Sans titre'}</div>
      <div class="carnet-item-st st-${st}">${stLabel[st]||st}</div>`;
    d.onclick=()=>{ carnetActif=i; renderCarnetList(); renderCarnetEditor(i); };
    list.appendChild(d);
  });
}

function renderCarnetEditor(i){
  const ed=document.getElementById('carnet-editor');
  const id=CA.idees[i];
  ed.innerHTML=`
    <div id="carnet-header">
      <input id="carnet-titre-input" value="${esc(id.titre||'')}" placeholder="Titre de l'idée…"
        oninput="CA.idees[${i}].titre=this.value;renderCarnetList()">
      <div id="carnet-meta">
        <select id="carnet-statut" onchange="CA.idees[${i}].statut=this.value;renderCarnetList()">
          <option value="germe" ${(id.statut||'germe')==='germe'?'selected':''}>Germe</option>
          <option value="dev" ${id.statut==='dev'?'selected':''}>En développement</option>
          <option value="ecrire" ${id.statut==='ecrire'?'selected':''}>À écrire</option>
        </select>
        <input id="carnet-genre-input" placeholder="genre…" value="${esc(id.genre||'')}"
          oninput="CA.idees[${i}].genre=this.value">
        <button onclick="carnetSupprimer(${i})" style="margin-left:auto;background:none;border:none;font-size:12px;color:var(--accent);cursor:pointer;font-family:'Crimson Pro',serif">Supprimer</button>
      </div>
    </div>
    <div id="carnet-body">
      <div class="carnet-section">
        <div class="carnet-section-label">Prémisse</div>
        <textarea class="carnet-field" placeholder="En une phrase : qui veut quoi contre quoi ?" oninput="CA.idees[${i}].premisse=this.value">${esc(id.premisse||'')}</textarea>
      </div>
      <div class="carnet-section">
        <div class="carnet-section-label">L'idée centrale</div>
        <textarea class="carnet-field" placeholder="Quelle est l'étincelle ? D'où vient cette idée ?" oninput="CA.idees[${i}].idee=this.value" style="min-height:90px">${esc(id.idee||'')}</textarea>
      </div>
      <div class="carnet-section">
        <div class="carnet-section-label">Thèmes & questions</div>
        <textarea class="carnet-field" placeholder="Quels thèmes veux-tu explorer ? Quelles questions sans réponse ?" oninput="CA.idees[${i}].themes=this.value">${esc(id.themes||'')}</textarea>
      </div>
      <div class="carnet-section">
        <div class="carnet-section-label">Personnages pressentis</div>
        <textarea class="carnet-field" placeholder="Qui peuple ce roman ? Même des ébauches…" oninput="CA.idees[${i}].persos=this.value">${esc(id.persos||'')}</textarea>
      </div>
      <div class="carnet-section">
        <div class="carnet-section-label">Références & inspirations</div>
        <textarea class="carnet-field" placeholder="Livres, films, souvenirs, phrases entendues…" oninput="CA.idees[${i}].refs=this.value">${esc(id.refs||'')}</textarea>
      </div>
      <div class="carnet-section">
        <div class="carnet-section-label">Notes libres</div>
        <textarea class="carnet-field" placeholder="Tout le reste — fragments, dialogues, images…" oninput="CA.idees[${i}].notes=this.value" style="min-height:120px">${esc(id.notes||'')}</textarea>
      </div>
    </div>`;
}

function carnetNouveau(){
  CA.idees.push({id:CA.nid++,titre:'',statut:'germe',genre:'',premisse:'',idee:'',themes:'',persos:'',refs:'',notes:''});
  carnetActif=CA.idees.length-1;
  renderCarnetList();
  renderCarnetEditor(carnetActif);
  setTimeout(()=>document.getElementById('carnet-titre-input')?.focus(),50);
}

function carnetSupprimer(i){
  if(!confirm('Supprimer cette idée ?')) return;
  CA.idees.splice(i,1);
  carnetActif=CA.idees.length>0?Math.min(i,CA.idees.length-1):null;
  renderCarnetList();
  if(carnetActif!==null) renderCarnetEditor(carnetActif);
  else document.getElementById('carnet-editor').innerHTML=`<div id="carnet-empty"><p>Sélectionnez une idée ou créez-en une nouvelle</p><button class="fb fb-s" style="max-width:180px" onclick="carnetNouveau()">+ Nouvelle idée</button></div>`;
}

function carnetSauvegarder(){
  const b=new Blob([JSON.stringify(CA,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b);
  a.download='mon_carnet.auteur'; a.click(); flash('Carnet sauvegardé ✓');
}

function carnetCharger(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.auteur';
  inp.onchange=e=>{
    const f=e.target.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=ev=>{ try{ CA=JSON.parse(ev.target.result); carnetActif=CA.idees.length>0?0:null; renderCarnetList(); if(carnetActif!==null) renderCarnetEditor(0); flash('Carnet chargé ✓'); }catch{ alert('Fichier invalide.'); }};
    r.readAsText(f);
  };
  inp.click();
}

// ── Recherche occurrences ─────────────────────────────────
function chercherOccurrences(nom){
  const resultats=[];
  const re=new RegExp(nom.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
  P.chapitres.forEach((ch,ci)=>{
    const div=document.createElement('div');
    div.innerHTML=ch.contenu||'';
    const txt=div.innerText||'';
    let m;
    while((m=re.exec(txt))!==null){
      const start=Math.max(0,m.index-40);
      const end=Math.min(txt.length,m.index+nom.length+40);
      let ctx=txt.slice(start,end).replace(/\n/g,' ');
      if(start>0) ctx='…'+ctx;
      if(end<txt.length) ctx=ctx+'…';
      resultats.push({ci,titre:ch.titre,ctx,idx:m.index});
    }
  });
  return resultats;
}

function afficherOccurrences(nom){
  // Retirer ancienne section si existe
  document.querySelectorAll('.occ-section').forEach(el=>el.remove());
  const res=chercherOccurrences(nom);
  if(!res.length) return;
  const sec=document.createElement('div');
  sec.className='occ-section';
  sec.innerHTML=`<div class="occ-title">Apparaît dans ${res.length} passage${res.length>1?'s':''}</div>`;
  res.forEach(r=>{
    const d=document.createElement('div');
    d.className='occ-item';
    d.innerHTML=`<div class="occ-chap">Chapitre ${r.ci+1} — ${r.titre}</div><div class="occ-ctx">${r.ctx}</div>`;
    d.onclick=()=>{
      if(planMode) togglePlan();
      save(); loadChap(r.ci);
      flash('↓ Chapitre '+( r.ci+1));
    };
    sec.appendChild(d);
  });
  document.getElementById('pf').appendChild(sec);
}

// ── Accordéons panel ──────────────────────────────────────
let accOuvert = 'perso';

function accToggle(which){
  if(accOuvert === which){
    // Fermer
    document.getElementById('acc-'+which).style.display='none';
    document.getElementById('arr-'+which).textContent='▸';
    accOuvert = null;
  } else {
    // Fermer l'ancien
    if(accOuvert){
      document.getElementById('acc-'+accOuvert).style.display='none';
      document.getElementById('arr-'+accOuvert).textContent='▸';
    }
    accOuvert = which;
    document.getElementById('acc-'+which).style.display='block';
    document.getElementById('arr-'+which).textContent='▾';
    renderAcc(which);
  }
  document.getElementById('pf').style.display='none';
  editId=null; photoTmp=null;
}

function renderAcc(which){
  const c=document.getElementById('acc-'+which);
  c.innerHTML='';
  if(which==='infos') renderAccInfos(c);
  else if(which==='perso') renderAccPerso(c);
  else if(which==='lieux') renderAccLieux(c);
  else if(which==='time') renderAccTime(c);
  else if(which==='liens') renderAccLiens(c);
  else if(which==='notesChap') renderAccNotesChap(c);
  else if(which==='recherches') renderAccRecherches(c);
  else renderAccNotes(c);
}

function renderAccPerso(c){
  const wrap=document.createElement('div'); wrap.className='psec';
  const hdr=document.createElement('div'); hdr.className='psec-t';
  hdr.innerHTML=`Personnages <button class="icon-btn" onclick="openNew('perso')" style="font-size:13px">＋</button>`;
  wrap.appendChild(hdr);
  if(!P.personnages.length){ wrap.innerHTML+=emptyMsg(); }
  P.personnages.forEach(p=>{
    const el=document.createElement('div'); el.className='card';
    const photoValide=p.photo && p.photo!=='(photo)' && p.photo.startsWith('data:');
    const av=photoValide
      ?`<div class="avatar"><img src="${p.photo}" onerror="this.parentElement.innerHTML='👤'"></div>`
      :`<div class="avatar">👤</div>`;
    el.innerHTML=av+`<div class="cb"><div class="cn">${p.nom}</div><div class="cs">${p.role||''}</div>${p.age?`<span class="ctag">${p.age}</span>`:''}</div>`;
    el.onclick=()=>openEdit('perso',p); wrap.appendChild(el);
  });
  c.appendChild(wrap);
}

function renderAccRecherches(c){
  const wrap=document.createElement('div'); wrap.className='psec';
  const hdr=document.createElement('div'); hdr.className='psec-t';
  hdr.innerHTML=`Recherches <button class="icon-btn" onclick="openNew('recherche')" style="font-size:13px">＋</button>`;
  wrap.appendChild(hdr);
  const recherches=P.recherches||[];
  if(!recherches.length){ wrap.innerHTML+=`<div style="font-size:13px;color:var(--ink4);font-style:italic;padding:6px 0">Aucune recherche. Notes de fond, sources, documentation — tout ce qui nourrit l'histoire sans y entrer directement.</div>`; }
  recherches.forEach(r=>{
    const el=document.createElement('div'); el.className='card';
    const apercu=(r.notes||'').slice(0,80);
    el.innerHTML=`<div class="avatar">🔎</div><div class="cb"><div class="cn">${esc(r.titre||'Sans titre')}</div><div class="cs">${esc(r.source||apercu)}</div></div>`;
    el.onclick=()=>openEdit('recherche',r); wrap.appendChild(el);
  });
  c.appendChild(wrap);
}

function renderAccInfos(c){
  const wrap=document.createElement('div'); wrap.style.cssText='padding:10px 13px 12px;';
  const infos=P.infosBase||[];
  if(infos.length){
    infos.forEach((info,i)=>{
      const row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:7px;';
      row.innerHTML=`
        <input class="fi" value="${esc(info.cle)}" placeholder="Clé" style="flex:1;margin:0;" oninput="(P.infosBase=P.infosBase||[])[${i}].cle=this.value;save();">
        <span style="color:var(--ink4);font-size:13px;flex-shrink:0;">→</span>
        <input class="fi" value="${esc(info.val)}" placeholder="Valeur" style="flex:2;margin:0;" oninput="(P.infosBase=P.infosBase||[])[${i}].val=this.value;save();">
        <button onclick="P.infosBase.splice(${i},1);save();renderAcc('infos');" style="background:none;border:none;color:var(--accent);font-size:16px;cursor:pointer;padding:0 2px;flex-shrink:0;">×</button>
      `;
      wrap.appendChild(row);
    });
  } else {
    const empty=document.createElement('div');
    empty.style.cssText='font-size:13px;color:var(--ink4);font-style:italic;padding:4px 0 8px;';
    empty.textContent='Aucune info. Ajouter une clé/valeur ci-dessous.';
    wrap.appendChild(empty);
  }
  const btn=document.createElement('button');
  btn.className='fb fb-s'; btn.style.cssText='width:100%;font-size:13px;margin-top:4px;';
  btn.textContent='＋ Ajouter une info';
  btn.onclick=()=>{
    if(!P.infosBase) P.infosBase=[];
    P.infosBase.push({cle:'',val:''});
    renderAcc('infos');
    // focus sur le dernier input clé
    setTimeout(()=>{ const ins=document.getElementById('acc-infos').querySelectorAll('input'); if(ins.length) ins[ins.length-2].focus(); },30);
  };
  wrap.appendChild(btn);
  c.appendChild(wrap);
}

function renderAccLieux(c){
  const wrap=document.createElement('div'); wrap.className='psec';
  const hdr=document.createElement('div'); hdr.className='psec-t';
  hdr.innerHTML=`Lieux <button class="icon-btn" onclick="openNew('lieu')" style="font-size:13px">＋</button>`;
  wrap.appendChild(hdr);
  if(!P.lieux.length){ wrap.innerHTML+=emptyMsg(); }
  P.lieux.forEach(l=>{
    const el=document.createElement('div'); el.className='card';
    el.innerHTML=`<div class="avatar">📍</div><div class="cb"><div class="cn">${l.nom}</div><div class="cs">${l.type||''}</div>${l.epoque?`<span class="ctag">${l.epoque}</span>`:''}</div>`;
    el.onclick=()=>openEdit('lieu',l); wrap.appendChild(el);
  });
  c.appendChild(wrap);
}

function renderAccTime(c){
  const wrap=document.createElement('div'); wrap.className='psec';
  wrap.style.paddingTop='8px';
  // Petit bouton ajouter
  const addRow=document.createElement('div');
  addRow.style.cssText='text-align:right;margin-bottom:6px;';
  addRow.innerHTML=`<button class="icon-btn" onclick="openNew('tl')" title="Ajouter un événement" style="font-size:12px;padding:1px 6px;">＋ événement</button>`;
  wrap.appendChild(addRow);
  if(!P.timeline.length){ const em=document.createElement('div'); em.innerHTML=emptyMsg(); wrap.appendChild(em); }
  // Scroll container
  const scroll=document.createElement('div');
  scroll.style.cssText='max-height:320px;overflow-y:auto;padding-right:2px;';
  P.timeline.forEach((ev,i)=>{
    const el=document.createElement('div'); el.className='tli'+(ev.fait?' tli-fait':'');
    el.style.cssText='display:flex;align-items:center;gap:7px;padding:6px 10px 6px 13px;';

    // Checkbox cocher/décocher
    const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=!!ev.fait;
    cb.className='tl-cb'; cb.title=ev.fait?'Marquer comme non fait':'Marquer comme fait';
    cb.addEventListener('click',e=>{ e.stopPropagation(); ev.fait=!ev.fait; save(); renderPanel(); });

    // Contenu principal — titre sur même ligne que la date
    const content=document.createElement('div'); content.className='tl-content'; content.style.cssText='flex:1;min-width:0;cursor:pointer;';
    const ligne=document.createElement('div'); ligne.style.cssText='display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;';
    const dateEl=document.createElement('span'); dateEl.className='tl-d'; dateEl.style.flexShrink='0'; dateEl.textContent=ev.date||'—';
    const titreEl=document.createElement('span'); titreEl.className='tl-t'; titreEl.style.cssText='font-size:13px;'; titreEl.textContent=ev.titre;
    ligne.appendChild(dateEl); ligne.appendChild(titreEl);
    if(ev.persos){ const p=document.createElement('div'); p.className='tl-p'; p.textContent=ev.persos; content.appendChild(ligne); content.appendChild(p); }
    else { content.appendChild(ligne); }
    content.onclick=()=>openEdit('tl',ev);

    // Bouton supprimer ×
    const del=document.createElement('button');
    del.textContent='×'; del.title='Supprimer';
    del.style.cssText='background:none;border:none;color:var(--ink4);font-size:15px;cursor:pointer;padding:0 2px;flex-shrink:0;opacity:0;transition:opacity .15s;line-height:1;';
    del.addEventListener('click',e=>{ e.stopPropagation(); if(confirm('Supprimer "'+ev.titre+'" ?')){ P.timeline.splice(i,1); save(); renderPanel(); if(document.getElementById('tl-modal-bg').style.display==='flex') renderModalTimeline(); } });
    el.addEventListener('mouseenter',()=>del.style.opacity='1');
    el.addEventListener('mouseleave',()=>del.style.opacity='0');

    el.appendChild(cb); el.appendChild(content); el.appendChild(del);
    scroll.appendChild(el);
  });
  wrap.appendChild(scroll);
  c.appendChild(wrap);
}

function renderAccNotes(c){
  const wrap=document.createElement('div');
  wrap.style.cssText='padding:11px 13px 14px;';
  const ta=document.createElement('textarea');
  ta.style.cssText='width:100%;background:var(--paper);border:1px solid var(--paper3);border-radius:4px;padding:8px 10px;font-family:"Crimson Pro",serif;font-size:14px;color:var(--ink);outline:none;resize:none;min-height:220px;line-height:1.65;';
  ta.placeholder='Notes libres sur ce roman…';
  ta.value=P.notesLibres||'';
  ta.addEventListener('input',()=>{ P.notesLibres=ta.value; });
  wrap.appendChild(ta);
  c.appendChild(wrap);
}

function renderAccNotesChap(c){
  const ch=P.chapitres[chapI];
  const wrap=document.createElement('div');
  wrap.style.cssText='padding:11px 13px 14px;';
  const label=document.createElement('div');
  label.style.cssText='font-size:11px;color:var(--ink4);font-family:"JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;';
  label.textContent=ch?.titre||'Ce chapitre';
  const ta=document.createElement('textarea');
  ta.style.cssText='width:100%;background:var(--paper);border:1px solid var(--paper3);border-radius:4px;padding:8px 10px;font-family:"Crimson Pro",serif;font-size:14px;color:var(--ink);outline:none;resize:none;min-height:220px;line-height:1.65;';
  ta.placeholder='Notes propres à ce chapitre — recherches, rappels, points à revoir…';
  ta.value=ch?.notesChap||'';
  ta.addEventListener('input',()=>{
    if(!ch) return;
    ch.notesChap=ta.value;
    ch._dirty=true;
  });
  wrap.appendChild(label);
  wrap.appendChild(ta);
  c.appendChild(wrap);
}

function renderPanel(){ if(accOuvert) renderAcc(accOuvert); }

function renderAccLiens(c){
  const wrap=document.createElement('div'); wrap.style.cssText='padding:10px 13px 12px;';
  const liens=P.liens||[];

  if(!liens.length){
    const em=document.createElement('div');
    em.innerHTML=emptyMsg();
    wrap.appendChild(em);
  } else {
    liens.forEach((lien,i)=>{
      const card=document.createElement('div');
      card.style.cssText='background:var(--paper);border:1px solid var(--paper3);border-radius:5px;padding:9px 11px;margin-bottom:7px;position:relative;';
      const titre=document.createElement('div');
      titre.style.cssText='font-size:13px;color:var(--ink);margin-bottom:2px;padding-right:20px;';
      titre.textContent=lien.titre||lien.url;
      const url=document.createElement('a');
      url.href=lien.url; url.target='_blank'; url.rel='noopener';
      url.style.cssText='font-size:11px;color:var(--gold);font-family:"JetBrains Mono",monospace;word-break:break-all;display:block;margin-bottom:2px;text-decoration:none;';
      url.textContent=lien.url;
      url.addEventListener('mouseover',()=>url.style.textDecoration='underline');
      url.addEventListener('mouseout',()=>url.style.textDecoration='none');
      if(lien.desc){
        const desc=document.createElement('div');
        desc.style.cssText='font-size:12px;color:var(--ink4);font-style:italic;margin-top:3px;';
        desc.textContent=lien.desc;
        card.appendChild(titre); card.appendChild(url); card.appendChild(desc);
      } else {
        card.appendChild(titre); card.appendChild(url);
      }
      // Boutons modifier/supprimer
      const actions=document.createElement('div');
      actions.style.cssText='position:absolute;top:7px;right:8px;display:flex;gap:4px;';
      const btnEdit=document.createElement('button');
      btnEdit.textContent='✎'; btnEdit.title='Modifier';
      btnEdit.style.cssText='background:none;border:none;color:var(--ink4);cursor:pointer;font-size:13px;padding:0;';
      btnEdit.onclick=()=>ouvrirFormLien(i);
      const btnDel=document.createElement('button');
      btnDel.textContent='×'; btnDel.title='Supprimer';
      btnDel.style.cssText='background:none;border:none;color:var(--accent);cursor:pointer;font-size:15px;padding:0;line-height:1;';
      btnDel.onclick=()=>{ if(confirm('Supprimer ce lien ?')){ P.liens.splice(i,1); save(); renderAcc('liens'); } };
      actions.appendChild(btnEdit); actions.appendChild(btnDel);
      card.appendChild(actions);
      wrap.appendChild(card);
    });
  }

  const btn=document.createElement('button');
  btn.className='fb fb-s'; btn.style.cssText='width:100%;font-size:13px;margin-top:4px;';
  btn.textContent='＋ Ajouter un lien';
  btn.onclick=()=>ouvrirFormLien(null);
  wrap.appendChild(btn);

  // Formulaire inline
  const form=document.createElement('div');
  form.id='lien-form'; form.style.cssText='display:none;margin-top:10px;background:var(--paper);border:1px solid var(--paper3);border-radius:6px;padding:12px;';
  form.innerHTML=`
    <label class="fl">URL</label><input class="fi" id="lf-url" placeholder="https://…">
    <label class="fl">Titre</label><input class="fi" id="lf-titre" placeholder="ex: Carte de la ville">
    <label class="fl">Description</label><input class="fi" id="lf-desc" placeholder="Quelques mots…">
    <div class="fbr" style="margin-top:8px;">
      <button class="fb fb-s" onclick="sauverLien()">Sauvegarder</button>
      <button class="fb fb-c" onclick="document.getElementById('lien-form').style.display='none'">Annuler</button>
    </div>
  `;
  wrap.appendChild(form);
  c.appendChild(wrap);
}

let lienEditIndex=null;
function ouvrirFormLien(i){
  lienEditIndex=i;
  const form=document.getElementById('lien-form');
  if(!form) return;
  form.style.display='block';
  if(i!=null){
    const l=P.liens[i];
    document.getElementById('lf-url').value=l.url||'';
    document.getElementById('lf-titre').value=l.titre||'';
    document.getElementById('lf-desc').value=l.desc||'';
  } else {
    document.getElementById('lf-url').value='';
    document.getElementById('lf-titre').value='';
    document.getElementById('lf-desc').value='';
  }
  setTimeout(()=>document.getElementById('lf-url').focus(),30);
}

function sauverLien(){
  const url=(document.getElementById('lf-url')?.value||'').trim();
  if(!url){ flash('L\'URL ne peut pas être vide.'); return; }
  const titre=(document.getElementById('lf-titre')?.value||'').trim();
  const desc=(document.getElementById('lf-desc')?.value||'').trim();
  if(!P.liens) P.liens=[];
  const obj={url,titre:titre||url,desc};
  if(lienEditIndex!=null) P.liens[lienEditIndex]=obj;
  else P.liens.push(obj);
  save(); renderAcc('liens'); flash('Lien sauvegardé ✓');
}





// ── Modal Timeline ─────────────────────────────────────────
let tlEditId=null;
let tlDragSrc=null;

function ouvrirModalTimeline(){
  document.getElementById('tl-modal-bg').style.display='flex';
  document.getElementById('tl-modal-form').style.display='none';
  renderModalTimeline();
}
function fermerModalTimeline(){ document.getElementById('tl-modal-bg').style.display='none'; }

function renderModalTimeline(){
  const list=document.getElementById('tl-modal-list');
  list.innerHTML='';
  if(!P.timeline.length){
    list.innerHTML=`<div style="font-size:13px;color:var(--ink4);font-style:italic;padding:10px 0">Aucun événement. Cliquez sur ＋ pour commencer.</div>`;
    return;
  }
  P.timeline.forEach((ev,i)=>{
    const row=document.createElement('div');
    row.className='tl-modal-row'+(ev.fait?' tl-modal-fait':'');
    row.draggable=true;
    row.dataset.id=ev.id;

    // Drag handles
    row.addEventListener('dragstart',e=>{ tlDragSrc=i; row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
    row.addEventListener('dragend',()=>{ row.classList.remove('dragging'); document.querySelectorAll('.tl-modal-row').forEach(r=>r.classList.remove('drag-over')); });
    row.addEventListener('dragover',e=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; row.classList.add('drag-over'); });
    row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
    row.addEventListener('drop',e=>{
      e.preventDefault(); row.classList.remove('drag-over');
      if(tlDragSrc===null||tlDragSrc===i) return;
      const moved=P.timeline.splice(tlDragSrc,1)[0];
      const dest=tlDragSrc<i?i:i;
      P.timeline.splice(dest,0,moved);
      tlDragSrc=null; save(); renderModalTimeline();
    });

    row.innerHTML=`
      <span class="tl-drag-handle" title="Glisser pour réordonner">⠿</span>
      <input type="checkbox" class="tl-cb" ${ev.fait?'checked':''} title="${ev.fait?'Marquer non fait':'Marquer fait'}" onclick="event.stopPropagation();P.timeline[${i}].fait=!P.timeline[${i}].fait;save();renderModalTimeline();if(accOuvert==='time')renderAcc('time');">
      <div class="tl-modal-content" onclick="ouvrirFormTlModal(${ev.id})">
        <span class="tl-d" style="min-width:90px;display:inline-block">${esc(ev.date||'—')}</span>
        <span class="tl-t">${esc(ev.titre)}</span>
        ${ev.persos?`<span class="tl-p" style="margin-left:8px">${esc(ev.persos)}</span>`:''}
        ${ev.notes?`<span class="tl-notes-preview">${esc(ev.notes.substring(0,60))}${ev.notes.length>60?'…':''}</span>`:''}
      </div>
      <button class="tl-insert-btn" title="Insérer un événement après" onclick="event.stopPropagation();ouvrirFormTlModal(null,${i+1})">＋</button>
    `;
    list.appendChild(row);
  });
}

function ouvrirFormTlModal(id, insertAfter){
  tlEditId=id;
  const form=document.getElementById('tl-modal-form');
  form.style.display='block';
  document.getElementById('tl-form-titre').textContent=id?'Modifier l\'événement':'Nouvel événement';
  const del=document.getElementById('tlf-del');

  if(id){
    const ev=P.timeline.find(t=>t.id===id);
    document.getElementById('tlf-titre').value=ev.titre||'';
    document.getElementById('tlf-date').value=ev.date||'';
    document.getElementById('tlf-persos').value=ev.persos||'';
    document.getElementById('tlf-notes').value=ev.notes||'';
    del.style.display='inline';
  } else {
    document.getElementById('tlf-titre').value='';
    document.getElementById('tlf-date').value='';
    document.getElementById('tlf-persos').value='';
    document.getElementById('tlf-notes').value='';
    del.style.display='none';
    form.dataset.insertAfter=insertAfter!=null?insertAfter:'';
  }
  setTimeout(()=>document.getElementById('tlf-titre').focus(),40);
  form.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function sauverEvTl(){
  const titre=(document.getElementById('tlf-titre').value||'').trim();
  if(!titre){ flash('Le titre ne peut pas être vide.'); return; }
  const date=document.getElementById('tlf-date').value.trim();
  const persos=document.getElementById('tlf-persos').value.trim();
  const notes=document.getElementById('tlf-notes').value.trim();

  if(tlEditId){
    const ev=P.timeline.find(t=>t.id===tlEditId);
    if(ev){ev.titre=titre;ev.date=date;ev.persos=persos;ev.notes=notes;}
  } else {
    const form=document.getElementById('tl-modal-form');
    const insertAfter=form.dataset.insertAfter!==''?parseInt(form.dataset.insertAfter):null;
    const newEv={id:P.nid++,titre,date,persos,notes,fait:false};
    if(insertAfter!=null) P.timeline.splice(insertAfter,0,newEv);
    else P.timeline.push(newEv);
  }
  document.getElementById('tl-modal-form').style.display='none';
  save();
  tlEditId=null;
  renderModalTimeline();
  if(accOuvert==='time') renderAcc('time');
  flash('Sauvegardé ✓');
}

function supprimerEvTl(){
  if(!tlEditId||!confirm('Supprimer cet événement ?')) return;
  P.timeline=P.timeline.filter(t=>t.id!==tlEditId);
  document.getElementById('tl-modal-form').style.display='none';
  save(); renderModalTimeline();
  if(accOuvert==='time') renderAcc('time');
}


function mkSec(label,type){
  const d=document.createElement('div'); d.className='psec';
  d.innerHTML=`<div class="psec-t">${label} <button class="icon-btn" onclick="openNew('${type}')" style="font-size:13px">＋</button></div>`;
  return d;
}
function emptyMsg(){ return `<div style="font-size:13px;color:var(--ink4);font-style:italic;padding:6px 0">Aucun élément. Clic droit sur du texte sélectionné pour en ajouter.</div>`; }

// ── Formulaires ───────────────────────────────────────────
function openNew(type, prefill){
  editId=null; photoTmp=null;
  if(type==='perso' && accOuvert!=='perso') accToggle('perso');
  else if(type==='lieu' && accOuvert!=='lieux') accToggle('lieux');
  else if(type==='tl' && accOuvert!=='time') accToggle('time');
  else if(type==='recherche' && accOuvert!=='recherches') accToggle('recherches');
  showForm(type, {nom:type!=='tl'?(prefill||''):'', titre:prefill||''});
}

function openEdit(type, obj){
  editId=obj.id; photoTmp=obj.photo||null;
  showForm(type, obj);
  // Chercher occurrences du nom dans le texte
  const nom=obj.nom||(type==='tl'?obj.titre:'');
  if(nom) setTimeout(()=>afficherOccurrences(nom),50);
}

function showForm(type, obj){
  const f=document.getElementById('pf'); f.style.display='block';
  let h='';
  if(type==='perso'){
    const src=photoTmp||obj.photo||'';
    h=`<h4>${editId?'Modifier':'Nouveau'} personnage</h4>
    <div class="pz">
      <div class="pp" id="pp">${src?`<img src="${src}">`:'👤'}</div>
      <div>
        <button class="pb" onclick="document.getElementById('pi').click()">Choisir photo</button>
        ${src?`<button class="pb" onclick="delPhoto()" style="margin-top:4px;color:var(--accent)">Retirer</button>`:''}
      </div>
    </div>
    <label class="fl">Nom</label><input class="fi" id="f1" value="${esc(obj.nom||'')}">
    <label class="fl">Rôle</label><input class="fi" id="f2" value="${esc(obj.role||'')}">
    <label class="fl">Âge</label><input class="fi" id="f3" value="${esc(obj.age||'')}">
    <label class="fl">Physique</label><textarea class="fi fta" id="f5" placeholder="Silhouette, visage, façon de se tenir, signes distinctifs…" style="min-height:70px">${esc(obj.physique||'')}</textarea>
    <label class="fl">Personnalité</label><textarea class="fi fta" id="f6" placeholder="Caractère, qualités, défauts, manies, façon de parler…" style="min-height:70px">${esc(obj.personnalite||'')}</textarea>
    <label class="fl">Histoire / passé</label><textarea class="fi fta" id="f7" placeholder="D'où vient-il·elle ? Ce qui l'a façonné·e…" style="min-height:70px">${esc(obj.histoire||'')}</textarea>
    <label class="fl">Objectif / motivation</label><textarea class="fi fta" id="f8" placeholder="Que veut-il·elle ? Qu'est-ce qui le·la freine ?" style="min-height:70px">${esc(obj.objectif||'')}</textarea>
    <label class="fl">Notes</label><textarea class="fi fta" id="f4" style="min-height:90px">${esc(obj.notes||'')}</textarea>`;
  } else if(type==='lieu'){
    h=`<h4>${editId?'Modifier':'Nouveau'} lieu</h4>
    <label class="fl">Nom</label><input class="fi" id="f1" value="${esc(obj.nom||'')}">
    <label class="fl">Type</label><input class="fi" id="f2" value="${esc(obj.type||'')}">
    <label class="fl">Époque</label><input class="fi" id="f3" value="${esc(obj.epoque||'')}">
    <label class="fl">Notes</label><textarea class="fi fta" id="f4">${esc(obj.notes||'')}</textarea>`;
  } else if(type==='recherche'){
    h=`<h4>${editId?'Modifier':'Nouvelle'} recherche</h4>
    <label class="fl">Titre</label><input class="fi" id="f1" placeholder="ex: Procédure d'enquête, Argot des années 20…" value="${esc(obj.titre||obj.nom||'')}">
    <label class="fl">Source</label><input class="fi" id="f2" placeholder="Livre, site, personne ressource…" value="${esc(obj.source||'')}">
    <label class="fl">Contenu</label><textarea class="fi fta" id="f4" style="min-height:180px">${esc(obj.notes||'')}</textarea>`;
  } else {
    h=`<h4>${editId?'Modifier':'Nouvel'} événement</h4>
    <label class="fl">Titre</label><input class="fi" id="f1" value="${esc(obj.titre||obj.nom||'')}">
    <label class="fl">Date / Moment</label><input class="fi" id="f2" placeholder="Jour 3, Été 1842…" value="${esc(obj.date||'')}">
    <label class="fl">Personnages</label><input class="fi" id="f3" value="${esc(obj.persos||'')}">
    <label class="fl">Notes</label><textarea class="fi fta" id="f4">${esc(obj.notes||'')}</textarea>`;
  }
  h+=`<div class="fbr">
    <button class="fb fb-s" onclick="saveForm('${type}')">Sauvegarder</button>
    <button class="fb fb-c" onclick="closeForm()">Annuler</button>
  </div>`;
  if(editId) h+=`<div style="margin-top:8px;text-align:right"><button onclick="delItem('${type}')" style="background:none;border:none;font-size:12px;color:var(--accent);cursor:pointer;font-family:'Crimson Pro',serif">Supprimer</button></div>`;
  f.innerHTML=h;
  setTimeout(()=>{ const n=document.getElementById('f1'); if(n)n.focus(); },40);
}

function closeForm(){
  document.getElementById('pf').style.display='none';
  editId=null; photoTmp=null;
  renderPanel();
}

function photoLue(input){
  const file=input.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=(e)=>{
    const img=new Image();
    img.onload=()=>{
      const MAX=200;
      let w=img.width, h=img.height;
      if(w>h){ if(w>MAX){h=Math.round(h*MAX/w);w=MAX;} }
      else { if(h>MAX){w=Math.round(w*MAX/h);h=MAX;} }
      const canvas=document.createElement('canvas');
      canvas.width=w; canvas.height=h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
      photoTmp=canvas.toDataURL('image/jpeg',0.72);
      const pp=document.getElementById('pp');
      if(pp) pp.innerHTML=`<img src="${photoTmp}">`;
    };
    img.src=e.target.result;
  };
  r.readAsDataURL(file); input.value='';
}
function delPhoto(){ photoTmp=null; const pp=document.getElementById('pp'); if(pp) pp.innerHTML='👤'; }

function saveForm(type){
  const nom=(document.getElementById('f1')?.value||'').trim();
  if(!nom){ flash('Le nom ne peut pas être vide.'); return; }
  const c2=(document.getElementById('f2')?.value||'').trim();
  const c3=(document.getElementById('f3')?.value||'').trim();
  const notes=(document.getElementById('f4')?.value||'').trim();
  if(type==='perso'){
    const physique=(document.getElementById('f5')?.value||'').trim();
    const personnalite=(document.getElementById('f6')?.value||'').trim();
    const histoire=(document.getElementById('f7')?.value||'').trim();
    const objectif=(document.getElementById('f8')?.value||'').trim();
    if(editId){ const x=P.personnages.find(p=>p.id===editId); if(x){x.nom=nom;x.role=c2;x.age=c3;x.notes=notes;x.physique=physique;x.personnalite=personnalite;x.histoire=histoire;x.objectif=objectif;x.photo=photoTmp!==null?photoTmp:x.photo;} }
    else P.personnages.push({id:P.nid++,nom,role:c2,age:c3,notes,physique,personnalite,histoire,objectif,photo:photoTmp});
  } else if(type==='lieu'){
    if(editId){ const x=P.lieux.find(l=>l.id===editId); if(x){x.nom=nom;x.type=c2;x.epoque=c3;x.notes=notes;} }
    else P.lieux.push({id:P.nid++,nom,type:c2,epoque:c3,notes});
  } else if(type==='recherche'){
    if(!P.recherches) P.recherches=[];
    if(editId){ const x=P.recherches.find(r=>r.id===editId); if(x){x.titre=nom;x.source=c2;x.notes=notes;} }
    else P.recherches.push({id:P.nid++,titre:nom,source:c2,notes});
  } else {
    if(editId){ const x=P.timeline.find(t=>t.id===editId); if(x){x.titre=nom;x.date=c2;x.persos=c3;x.notes=notes;} }
    else P.timeline.push({id:P.nid++,titre:nom,date:c2,persos:c3,notes,fait:false});
  }
  save(); closeForm(); renderPanel(); flash('Sauvegardé ✓');
}

function delItem(type){
  if(!editId||!confirm('Supprimer ?')) return;
  if(type==='perso') P.personnages=P.personnages.filter(x=>x.id!==editId);
  else if(type==='lieu') P.lieux=P.lieux.filter(x=>x.id!==editId);
  else if(type==='recherche') P.recherches=(P.recherches||[]).filter(x=>x.id!==editId);
  else P.timeline=P.timeline.filter(x=>x.id!==editId);
  editId=null; closeForm(); renderPanel();
}

// ── Clic droit ────────────────────────────────────────────
function showCtx(e){
  const sel=window.getSelection();
  if(!sel||!sel.toString().trim()) return;
  e.preventDefault();
  ctxSel=sel.toString().trim();
  const m=document.getElementById('ctx');
  m.style.display='block';
  m.style.left=Math.min(e.clientX,window.innerWidth-215)+'px';
  m.style.top=Math.min(e.clientY,window.innerHeight-155)+'px';
}
function ctxDo(t){
  document.getElementById('ctx').style.display='none';
  if(t==='copy'){document.execCommand('copy');return;}
  openNew(t,ctxSel);
}

// ── Sauvegarde fichier ────────────────────────────────────
async function partagerLecture(){
  if(!P.projet_cloud_id){
    alert('Ouvrez d\'abord un projet depuis le tableau de bord, puis sauvegardez dans le cloud ☁');
    return;
  }
  const { error } = await sb.from('projets')
    .update({ partage: true })
    .eq('id', P.projet_cloud_id)
    .eq('user_id', sbUser.id);
  if(error){ flash('Erreur : ' + error.message); return; }
  const base = window.location.href.replace(/\/[^/]*$/, '/');
  const lien = `${base}lecture.html?p=${P.projet_cloud_id}`;
  navigator.clipboard.writeText(lien).catch(()=>{});
  prompt('Lien de lecture copié — partagez-le à vos bêtas :', lien);
  flash('Projet partagé ✓');
}


// ── Restauration depuis backup WHC ───────────────────────
const BACKUP_TOKEN = 'encre_backup_2026_suz';
const BACKUP_BASE  = 'https://iletaitunefois.net/encre';

async function ouvrirRestoreBackup(){
  if(!P.projet_cloud_id){ flash('Projet non sauvegardé dans le cloud'); return; }

  // Afficher une modale de chargement
  const overlay = document.createElement('div');
  overlay.id = '_restore-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:5000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div style="background:var(--paper);border-radius:8px;padding:28px 32px;max-width:480px;width:92%;font-family:'Crimson Pro',serif;color:var(--ink);max-height:80vh;display:flex;flex-direction:column;">
      <div style="font-size:18px;font-weight:600;margin-bottom:4px;">Restaurer un backup</div>
      <div style="font-size:13px;color:var(--ink3);margin-bottom:20px;">Choisissez une sauvegarde — le projet actuel sera remplacé.</div>
      <div id="_restore-list" style="overflow-y:auto;flex:1;margin-bottom:16px;">
        <div style="color:var(--ink4);font-size:14px;">Chargement…</div>
      </div>
      <div style="display:flex;justify-content:flex-end;">
        <button onclick="document.getElementById('_restore-overlay').remove()" style="padding:8px 20px;background:none;border:1px solid var(--paper3);border-radius:4px;font-family:'Crimson Pro',serif;font-size:14px;cursor:pointer;color:var(--ink3);">Annuler</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  try {
    const resp = await fetch(`${BACKUP_BASE}/list-backups.php?projet_id=${P.projet_cloud_id}`, {
      headers: { 'X-Encre-Token': BACKUP_TOKEN }
    });
    const data = await resp.json();
    const list = document.getElementById('_restore-list');

    if(!data.fichiers?.length){
      list.innerHTML = '<div style="color:var(--ink4);font-size:14px;">Aucun backup disponible pour ce projet.</div>';
      return;
    }

    list.innerHTML = data.fichiers.map(f => {
      const date = new Date(f.sauvegarde_le).toLocaleString('fr-CA', {
        day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'
      });
      const taille = (f.taille / 1024).toFixed(0) + ' ko';
      return `<div style="border:1px solid var(--paper3);border-radius:6px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:background .15s;"
        onmouseover="this.style.background='var(--paper2)'" onmouseout="this.style.background=''"
        onclick="restaurerBackup('${f.fichier}')">
        <div style="font-size:15px;font-weight:600;">${f.nom}</div>
        <div style="font-size:12px;color:var(--ink3);margin-top:3px;">${date} · ${f.nb_chapitres} chapitres · ${taille}</div>
      </div>`;
    }).join('');
  } catch(e) {
    document.getElementById('_restore-list').innerHTML = '<div style="color:var(--accent);">Erreur : ' + e.message + '</div>';
  }
}

async function restaurerBackup(fichier){
  if(!confirm(`Restaurer ce backup ?\n\nLe contenu actuel sera remplacé — assurez-vous d'avoir sauvegardé.`)) return;

  document.getElementById('_restore-overlay')?.remove();
  flash('Restauration en cours…');

  try {
    const resp = await fetch(`${BACKUP_BASE}/get-backup.php?projet_id=${P.projet_cloud_id}&fichier=${encodeURIComponent(fichier)}`, {
      headers: { 'X-Encre-Token': BACKUP_TOKEN }
    });
    const data = await resp.json();
    if(data.error){ flash('Erreur : ' + data.error); return; }

    // Restaurer le projet
    const backup = data.contenu;
    Object.assign(P, backup);
    chapI = 0;
    renderSidebar();
    loadChap(0);
    renderPanel();
    flash('Backup restauré ✓ — pensez à sauvegarder dans le cloud.');
  } catch(e) {
    flash('Erreur de restauration : ' + e.message);
  }
}

function sauvegarderLocal(){
  save();
  const b=new Blob([JSON.stringify(P,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(b);
  a.download=(P.titre||'roman').replace(/\s+/g,'_')+'.encre';
  a.click(); flash('Copie locale téléchargée ✓');
}
function charger(){ document.getElementById('fi').click(); }
function ouvrir(input){
  const file=input.files[0]; if(!file) return;
  const r=new FileReader();
  r.onload=(e)=>{
    try{ P=JSON.parse(e.target.result); document.getElementById('projet-nom').value=P.titre; chapI=0; loadChap(0); renderPanel(); updateSbProjet(); flash('Chargé : '+P.titre); }
    catch{ alert('Fichier invalide.'); }
  };
  r.readAsText(file); input.value='';
}
function importerDocx(){ document.getElementById('fi-docx').click(); }

async function lireDocx(input){
  const file=input.files[0]; if(!file) return;
  input.value='';
  if(!confirm('Importer ce fichier Word ? Le projet actuel sera remplacé.\n\nLes Titre 1 = nouveaux chapitres, Titre 2 = sous-titres de chapitre.')) return;

  try{
    if(typeof JSZip==='undefined') throw new Error('JSZip non chargé — connexion internet requise.');
    flash('Lecture du fichier…');

    const ab=await file.arrayBuffer();
    const zip=await JSZip.loadAsync(ab);

    // Lire document.xml
    const docXmlStr=await zip.file('word/document.xml').async('string');
    const parser=new DOMParser();
    const doc=parser.parseFromString(docXmlStr,'text/xml');

    // Lire styles.xml pour mapper styleId → nom normalisé
    let styleMap={};
    const stylesFile=zip.file('word/styles.xml');
    if(stylesFile){
      const stylesStr=await stylesFile.async('string');
      const stylesDoc=parser.parseFromString(stylesStr,'text/xml');
      stylesDoc.querySelectorAll('style').forEach(s=>{
        const id=s.getAttribute('w:styleId')||'';
        const nameEl=s.querySelector('name');
        const name=(nameEl?.getAttribute('w:val')||'').toLowerCase();
        styleMap[id.toLowerCase()]=name;
      });
    }

    function getStyleName(pEl){
      const styleEl=pEl.querySelector('pStyle');
      if(!styleEl) return '';
      const id=(styleEl.getAttribute('w:val')||'').toLowerCase();
      // D'abord chercher dans styleMap
      if(styleMap[id]) return styleMap[id];
      // Sinon utiliser l'id directement
      return id;
    }

    function isHeading1(name){ return /heading\s*1|titre\s*1|heading1/.test(name); }
    function isHeading2(name){ return /heading\s*2|titre\s*2|heading2/.test(name); }

    // Extraire le texte d'un paragraphe en conservant gras/italique
    function paraToHtml(pEl){
      let html='';
      pEl.querySelectorAll('r').forEach(r=>{
        const rPr=r.querySelector('rPr');
        const bold=rPr?.querySelector('b')&&!rPr?.querySelector('b[w\\:val="false"]');
        const italic=rPr?.querySelector('i')&&!rPr?.querySelector('i[w\\:val="false"]');
        const underline=rPr?.querySelector('u[w\\:val]:not([w\\:val="none"])');
        let txt='';
        r.querySelectorAll('t').forEach(t=>{ txt+=t.textContent; });
        if(!txt) return;
        const escaped=txt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        let span=escaped;
        if(bold) span=`<strong>${span}</strong>`;
        if(italic) span=`<em>${span}</em>`;
        if(underline) span=`<u>${span}</u>`;
        html+=span;
      });
      return html;
    }

    // Parcourir les paragraphes et construire les chapitres
    const chapitres=[];
    let chapCourant=null;
    let chapNiveau=2;
    let contenuCourant=[];

    const paragraphes=doc.querySelectorAll('body > p, body p');
    paragraphes.forEach(p=>{
      const styleName=getStyleName(p);
      const texte=p.textContent.trim();

      if(isHeading1(styleName)||isHeading2(styleName)){
        if(chapCourant!==null){
          chapitres.push({id:P.nid++, titre:chapCourant, contenu:contenuCourant.join(''), mots:0, niveau:chapNiveau});
        }
        chapCourant=texte||'Sans titre';
        chapNiveau=isHeading1(styleName)?1:2;
        contenuCourant=[];
      } else {
        // Texte normal
        if(chapCourant===null){ chapCourant='Chapitre I'; }
        const html=paraToHtml(p);
        if(html) contenuCourant.push(`<p>${html}</p>`);
      }
    });

    // Dernier chapitre
    if(chapCourant!==null){
      chapitres.push({id:P.nid++, titre:chapCourant, contenu:contenuCourant.join(''), mots:0, niveau:chapNiveau});
    }

    if(!chapitres.length){
      flash('Aucun chapitre détecté — vérifiez que les titres utilisent les styles Titre 1/Titre 2 dans Word.');
      return;
    }

    // Calculer les mots
    chapitres.forEach(ch=>{
      const div=document.createElement('div'); div.innerHTML=ch.contenu;
      const t=div.innerText.trim();
      ch.mots=t?t.split(/\s+/).length:0;
    });

    // Préserver auteur_id : reprendre celui d'un chapitre existant au même titre,
    // sinon déduire du titre (collab), sinon utilisateur courant (solo)
    const ancienParTitre = {};
    (P.chapitres||[]).forEach(ch => { if(ch.titre) ancienParTitre[ch.titre.trim().toLowerCase()] = ch.auteur_id; });
    chapitres.forEach(ch => {
      const cle = (ch.titre||'').trim().toLowerCase();
      if(ancienParTitre[cle]){
        ch.auteur_id = ancienParTitre[cle];
      } else if(P._collab){
        // Déduire du titre pour les projets collab
        if(/beck/i.test(ch.titre)) ch.auteur_id = '8bfd194f-f4b3-4cec-95e7-2ba0c569f204';
        else if(/davidson/i.test(ch.titre)) ch.auteur_id = 'a9e04574-68b4-4f3f-a6f4-39bbb4e9eb69';
        else ch.auteur_id = sbUser?.id || null;
      } else {
        ch.auteur_id = sbUser?.id || null;
      }
    });

    // Mettre à jour le projet
    const nomFichier=file.name.replace(/\.docx$/i,'');
    P.titre=nomFichier;
    P.chapitres=chapitres;
    document.getElementById('projet-nom').value=P.titre;
    chapI=0;

    // Vider la table chapitres avant l'import pour éviter les doublons
    if(P.projet_cloud_id && sb){
      await sb.from('chapitres').delete().eq('projet_id', P.projet_cloud_id);
    }
    // Recalculer la baseline après import pour ne pas compter les mots importés comme "écrits aujourd'hui"
    const totalImporte = chapitres.reduce((s,ch) => s + (ch.mots||0), 0);
    _baselineSession = totalImporte;
    // Mettre à jour snapshot_debut dans Supabase pour que le delta reparte de zéro
    if(sbUser && P.projet_cloud_id){
      const today = aujourdhui();
      sb.from('stats_ecriture').upsert({
        user_id: sbUser.id,
        projet_id: P.projet_cloud_id,
        date: today,
        mots: 0,
        snapshot_debut: totalImporte,
        total_mots: totalImporte
      }, { onConflict: 'user_id,projet_id,date' });
    }
    loadChap(0);
    renderPanel();
    updateSbProjet();
    flash(`Importé : ${chapitres.length} chapitre${chapitres.length>1?'s':''} ✓`);

  } catch(err){
    alert('Erreur import : '+err.message);
  }
}

function nouveauProjet(){
  if(!confirm('Nouveau projet ? Sauvegardez d\'abord si besoin.')) return;
  P={titre:'Nouveau Roman',auteur:'',sousTitre:'',genre:'',annee:new Date().getFullYear()+'',synopsis:'',chapitres:[{id:1,titre:'Chapitre I',contenu:'',mots:0}],personnages:[],lieux:[],timeline:[],recherches:[],nid:2,projet_cloud_id:null};
  document.getElementById('projet-nom').value=P.titre;
  document.getElementById('dashboard').classList.remove('on');
  fermerCarnetPage();
  setNavActive(null);
  chapI=0; loadChap(0); renderPanel(); updateSbProjet();
}

// ── Export TXT ────────────────────────────────────────────
function exportTxt(){
  save();
  let t=P.titre+'\n'+'═'.repeat(P.titre.length)+'\n\n';
  P.chapitres.forEach((c,i)=>{
    t+=rom(i+1)+'. '+c.titre+'\n'+'─'.repeat(38)+'\n\n';
    const d=document.createElement('div'); d.innerHTML=c.contenu;
    t+=(d.innerText||'')+'\n\n';
  });
  dl(new Blob([t],{type:'text/plain;charset=utf-8'}), (P.titre||'roman').replace(/\s+/g,'_')+'.txt');
}

// ── Export DOCX (sans CDN externe, via JSZip) ─────────────
// ── EXPORT PDF KDP 6×9 ─────────────────────────────────────
async function exportPdf(){
  save();
  const btn = document.getElementById('btn-pdf');
  btn.textContent = '⟳ PDF…'; btn.disabled = true;
  flash('Génération PDF…');

  try {
    const { jsPDF } = window.jspdf;
    const W = 152.4, H = 228.6; // 6×9" en mm
    const mGout = 19.05, mExt = 12.7, mHaut = 19.05, mBas = 22.23;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:[W,H] });

    const titre = P.titre || 'Roman';
    const auteur = P.auteur || '';
    let pageNum = 0;

    function mL(){ return pageNum%2!==0 ? mGout : mExt; }
    function mR(){ return W - (pageNum%2!==0 ? mExt : mGout); }
    function tW(){ return mR() - mL(); }

    function numPage(){
      if(pageNum > 2){
        doc.setFont('Times','normal'); doc.setFontSize(9); doc.setTextColor(80);
        doc.text(String(pageNum-2), W/2, H-8, {align:'center'});
        doc.setTextColor(0);
      }
    }

    function nouvellePage(){
      doc.addPage(); pageNum++;
    }

    function pageImpaire(){
      if(pageNum%2===0) nouvellePage();
    }

    // Page 1 — titre
    pageNum=1;
    doc.setFont('Times','italic'); doc.setFontSize(28);
    doc.text(titre, W/2, 80, {align:'center'});
    doc.setFont('Times','normal'); doc.setFontSize(12);
    doc.text(auteur, W/2, 95, {align:'center'});

    // Page 2 — infos
    nouvellePage();
    doc.setFont('Times','bold'); doc.setFontSize(12);
    doc.text(titre, W/2, mHaut+10, {align:'center'});
    doc.setFont('Times','normal'); doc.setFontSize(11);
    doc.text(auteur, W/2, mHaut+20, {align:'center'});
    if(P.genre||P.annee) doc.text(`${P.genre||''}${P.genre&&P.annee?' · ':''}${P.annee||''}`, W/2, mHaut+28, {align:'center'});
    numPage();

    // Chapitres
    let chapNum = 0;
    P.chapitres.forEach((ch) => {
      const niv = ch.niveau||2;
      nouvellePage(); pageImpaire();

      if(niv===1){
        // Page de partie — titre + sous-titre éventuel
        numPage();
        doc.setFont('Times','normal'); doc.setFontSize(22);
        doc.text((ch.titre||'').toUpperCase(), W/2, H/3, {align:'center'});
        if(ch.contenu){
          const tmp=document.createElement('div'); tmp.innerHTML=ch.contenu; normaliserTypoNode(tmp);
          const st=tmp.innerText.trim();
          if(st && st.length<120){
            doc.setFont('Times','italic'); doc.setFontSize(14);
            doc.text(doc.splitTextToSize(st,tW()), W/2, H/3+14, {align:'center'});
          }
        }
        return;
      }

      // Chapitre (niveau 2) — on affiche ch.titre tel quel comme en-tête
      chapNum++;
      numPage();
      doc.setFont('Times','normal'); doc.setFontSize(18);
      doc.text((ch.titre||String(chapNum)), W/2, mHaut+18, {align:'center'});
      if(!ch.contenu) return;

      const tmp=document.createElement('div'); tmp.innerHTML=ch.contenu; normaliserTypoNode(tmp);

      // Extraire les segments avec leur style depuis un nœud DOM
      function extraireSegments(noeud){
        const segs=[];
        function parcourir(n, bold, italic){
          if(n.nodeType===3){
            const t=n.textContent;
            if(t) segs.push({t, bold, italic});
          } else if(n.nodeType===1){
            const tag=n.tagName.toLowerCase();
            const b=bold||tag==='b'||tag==='strong';
            const i=italic||tag==='em'||tag==='i';
            n.childNodes.forEach(c=>parcourir(c,b,i));
          }
        }
        parcourir(noeud,false,false);
        return segs;
      }

      // Construire la liste de paragraphes, chacun = {segs, align} ou {type:'texto', cote, nom, msg}
      const paras=[];
      tmp.childNodes.forEach(n=>{
        if(n.classList?.contains('texto-bloc')){
          const cote=n.getAttribute('data-texto')||'gauche';
          const nom=(n.querySelector('.texto-nom')?.innerText||'').trim();
          const msg=(n.querySelector('.texto-msg')?.innerText||'').trim();
          if(msg) paras.push({type:'texto', cote, nom, msg});
          return;
        }
        const segs=extraireSegments(n);
        const texte=segs.map(s=>s.t).join('').trim();
        if(!texte) return;
        const styleAlign=(n.style?.textAlign||'').toLowerCase();
        const align=styleAlign==='center'?'center':styleAlign==='right'?'right':'justify';
        paras.push({segs, align});
      });

      doc.setFont('Times','normal'); doc.setFontSize(11);
      let y=mHaut+40, first=true;

      // Écrire une ligne avec segments stylisés, justifiée ou non
      function ecrireLigne(segsDeLigne, xBase, largeurDispo, justifier){
        // Aplatir en mots avec leur style
        const mots=[];
        segsDeLigne.forEach(seg=>{
          const style=(seg.bold&&seg.italic)?'bolditalic':seg.bold?'bold':seg.italic?'italic':'normal';
          // Séparer sur les espaces en gardant les espaces
          const parties=seg.t.split(/( +)/);
          parties.forEach(p=>{
            if(p==='') return;
            if(/^ +$/.test(p)){
              if(mots.length>0) mots[mots.length-1].apresEspace=(mots[mots.length-1].apresEspace||0)+p.length;
            } else {
              mots.push({mot:p, style, apresEspace:0});
            }
          });
        });
        if(!mots.length) return;

        if(justifier && mots.length>1){
          // Calculer largeur totale des mots
          let largeurMots=0;
          mots.forEach(m=>{ doc.setFont('Times',m.style); largeurMots+=doc.getTextWidth(m.mot); });
          const espaceTotal=largeurDispo-largeurMots;
          const espaceParGap=espaceTotal/(mots.length-1);
          let x=xBase;
          mots.forEach((m,mi)=>{
            doc.setFont('Times',m.style);
            doc.text(m.mot, x, y);
            x+=doc.getTextWidth(m.mot);
            if(mi<mots.length-1) x+=espaceParGap;
          });
        } else {
          let x=xBase;
          mots.forEach(m=>{
            doc.setFont('Times',m.style);
            doc.text(m.mot, x, y);
            x+=doc.getTextWidth(m.mot);
            if(m.apresEspace){
              doc.setFont('Times','normal');
              x+=doc.getTextWidth(' ')*m.apresEspace;
            }
          });
        }
        doc.setFont('Times','normal');
      }

      // Découper un paragraphe (segments) en lignes en tenant compte des styles
      function decouperEnLignes(segs, largeur){
        const lignes=[];
        let ligneCourante=[], largeurCourante=0, premierMot=true;
        function ajouterMot(mot, style, dernier){
          doc.setFont('Times',style);
          const lMot=doc.getTextWidth(mot);
          const lEspace=premierMot?0:doc.getTextWidth(' ');
          if(!premierMot && largeurCourante+lEspace+lMot>largeur+0.01){
            lignes.push({segs:ligneCourante, fin:false});
            ligneCourante=[{t:mot,style}];
            largeurCourante=lMot;
            premierMot=false;
          } else {
            if(!premierMot) largeurCourante+=lEspace;
            ligneCourante.push({t:mot,style,space:!premierMot});
            largeurCourante+=lMot;
            premierMot=false;
          }
        }
        segs.forEach(seg=>{
          const style=(seg.bold&&seg.italic)?'bolditalic':seg.bold?'bold':seg.italic?'italic':'normal';
          // Tokeniser : mots et espaces
          seg.t.split(/(\s+)/).forEach(tok=>{
            if(!tok) return;
            if(/^\s+$/.test(tok)){
              // espace entre mots — géré dans ajouterMot
            } else {
              // Peut contenir des espaces internes ? Non après split
              ajouterMot(tok, style, false);
            }
          });
        });
        if(ligneCourante.length) lignes.push({segs:ligneCourante, fin:true});
        // Marquer la vraie dernière ligne
        if(lignes.length) lignes[lignes.length-1].fin=true;
        return lignes;
      }

      paras.forEach(para=>{
        // ── Bulle texto ──────────────────────────────────────
        if(para.type==='texto'){
          const droite=para.cote==='droite';
          const maxBulle=tW()*0.62; // bulle max 62% de la largeur
          doc.setFont('Times','normal'); doc.setFontSize(9);
          const lignesMsg=doc.splitTextToSize(para.msg, maxBulle-6);
          const lignesNom=para.nom ? doc.splitTextToSize(para.nom, maxBulle-6) : [];
          const hauteurContenu=(lignesNom.length*4.5)+(lignesMsg.length*4.5)+5;
          const largeurBulle=Math.min(maxBulle, doc.getTextWidth(para.msg)+10);
          // Recalculer avec la vraie largeur
          const lignesMsgF=doc.splitTextToSize(para.msg, largeurBulle-6);
          const hautF=(lignesNom.length>0?4.5:0)+(lignesMsgF.length*4.5)+5;

          if(y+hautF>H-mBas-5){
            numPage(); nouvellePage(); numPage();
            doc.setFont('Times','normal'); doc.setFontSize(11); doc.setTextColor(0);
            y=mHaut+6;
          }

          const xBulle=droite ? mL()+tW()-largeurBulle : mL();

          // Rectangle bulle (fond léger)
          doc.setFillColor(droite?220:240, droite?230:240, droite?245:240);
          doc.setDrawColor(180,180,180);
          doc.roundedRect(xBulle, y-3, largeurBulle, hautF, 2, 2, 'FD');

          // Nom expéditeur
          let yy=y+1;
          if(para.nom){
            doc.setFont('Times','bolditalic'); doc.setFontSize(8); doc.setTextColor(100,100,100);
            doc.text(para.nom, xBulle+3, yy);
            yy+=4.5;
          }
          // Message
          doc.setFont('Times','normal'); doc.setFontSize(9); doc.setTextColor(30,30,30);
          lignesMsgF.forEach(l=>{ doc.text(l, xBulle+3, yy); yy+=4.5; });
          doc.setTextColor(0);

          y+=hautF+3;
          first=false;
          return;
        }
        const {segs, align} = para;
        const ind=(first && align==='justify')?0:7;
        // Pour centré/droite : pas d'indentation, pas de justification
        const larg= align==='justify' ? tW()-ind : tW();
        const lignes=decouperEnLignes(segs, larg);

        lignes.forEach((ligne,li)=>{
          if(y>H-mBas-5){
            numPage(); nouvellePage(); numPage();
            doc.setFont('Times','normal'); doc.setFontSize(11); doc.setTextColor(0);
            y=mHaut+6;
          }

          if(align==='center' || align==='right'){
            // Calculer la largeur réelle de la ligne pour centrer/aligner
            let largLigne=0;
            ligne.segs.forEach((s,si)=>{
              doc.setFont('Times', s.style==='bold'||s.style==='bolditalic'?s.style:s.style==='italic'?'italic':'normal');
              largLigne+=doc.getTextWidth(s.t);
              if(si<ligne.segs.length-1) largLigne+=doc.getTextWidth(' ');
            });
            const xBase= align==='center' ? mL()+(tW()-largLigne)/2 : mL()+tW()-largLigne;
            const segsAvecEspaces=[];
            ligne.segs.forEach((s,si)=>{
              if(si>0) segsAvecEspaces.push({t:' ',bold:false,italic:false});
              segsAvecEspaces.push({t:s.t,bold:s.style==='bold'||s.style==='bolditalic',italic:s.style==='italic'||s.style==='bolditalic'});
            });
            ecrireLigne(segsAvecEspaces, xBase, largLigne, false);
          } else {
            const xBase=mL()+(li===0?ind:0);
            const largeurDispo=tW()-(li===0?ind:0);
            const justifier=!ligne.fin && ligne.segs.length>1;
            const segsAvecEspaces=[];
            ligne.segs.forEach((s,si)=>{
              if(s.space) segsAvecEspaces.push({t:' ',bold:false,italic:false});
              segsAvecEspaces.push({t:s.t,bold:s.style==='bold'||s.style==='bolditalic',italic:s.style==='italic'||s.style==='bolditalic'});
            });
            ecrireLigne(segsAvecEspaces, xBase, largeurDispo, justifier);
          }
          y+=6.5;
        });
        y+=1.5; first=false;
      });
      numPage();
    });

    doc.save((titre.replace(/\s+/g,'_')||'roman')+'_encrier.pdf');
    flash('PDF généré ✓');
  } catch(e){
    flash('Erreur PDF : '+e.message); console.error(e);
  }
  btn.textContent='→ PDF'; btn.disabled=false;
}

async function exportDocx(){
  save(); // S'assurer que le chapitre actuel est sauvegardé avant export
  save();
  const btn=document.getElementById('btn-docx');
  btn.textContent='→ Génération…'; btn.disabled=true;
  try{
    if(typeof JSZip==='undefined') throw new Error('JSZip non chargé — vérifiez votre connexion internet.');

    // ── Helpers XML ──
    const x=(tag,attrs,inner)=>{
      const a=Object.entries(attrs||{}).map(([k,v])=>` ${k}="${v}"`).join('');
      return inner===undefined?`<${tag}${a}/>`:`<${tag}${a}>${inner}</${tag}>`;
    };
    const esc2=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    // ── Convertir nœuds HTML en runs Word XML ──
    function nodeToRuns(node, bold=false, italic=false, underline=false){
      if(node.nodeType===3){
        const txt=node.textContent;
        if(!txt) return '';
        let rPr='';
        if(bold) rPr+='<w:b/>';
        if(italic) rPr+='<w:i/>';
        if(underline) rPr+='<w:u w:val="single"/>';
        rPr+=`<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/>`;
        return x('w:r',{},x('w:rPr',{},rPr)+x('w:t',{'xml:space':'preserve'},esc2(txt)));
      }
      const tag=node.nodeName;
      const b2=bold||(tag==='B'||tag==='STRONG');
      const i2=italic||(tag==='I'||tag==='EM');
      const u2=underline||(tag==='U');
      return Array.from(node.childNodes).map(c=>nodeToRuns(c,b2,i2,u2)).join('');
    }

    // ── Construire les paragraphes du corps ──
    function htmlToParagraphs(html, indentFirst=true){
      const div=document.createElement('div');
      div.innerHTML=html||'';
      normaliserTypoNode(div);
      const paras=[];
      function pTxt(txt,indent){
        const pPr=indent?'<w:ind w:firstLine="720"/><w:spacing w:after="200"/>':'<w:spacing w:after="200"/>';
        return x('w:p',{},x('w:pPr',{},pPr)+x('w:r',{},x('w:rPr',{},'<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/>') +x('w:t',{'xml:space':'preserve'},esc2(txt))));
      }
      function pSimple(txt){
        return x('w:p',{},x('w:pPr',{},'<w:spacing w:after="100"/>') +x('w:r',{},x('w:rPr',{},'<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/>') +x('w:t',{'xml:space':'preserve'},esc2(txt))));
      }
      div.childNodes.forEach(node=>{
        // Bloc texto → syntaxe Thermidor
        if(node.nodeType===1&&node.classList&&node.classList.contains('texto-bloc')){
          const cote=node.getAttribute('data-texto')||'gauche';
          const nom=node.querySelector('.texto-nom')?.textContent?.trim()||'';
          const msg=node.querySelector('.texto-msg')?.innerText?.trim()||'';
          paras.push(pSimple(`##${cote}:${nom}`));
          msg.split('\n').forEach(l=>{ if(l.trim()) paras.push(pSimple(l.trim())); });
          paras.push(pSimple('##fin'));
          paras.push(x('w:p',{},x('w:pPr',{},'<w:spacing w:after="100"/>')));
          return;
        }
        // Noeud texte nu
        if(node.nodeType===3){
          const txt=node.textContent.trim();
          if(!txt) return;
          paras.push(pTxt(txt, indentFirst));
          return;
        }
        if(node.nodeName==='BR') return;
        // <div> ou <p> avec seulement un <br> → paragraphe vide, ignorer
        if((node.nodeName==='DIV'||node.nodeName==='P') && node.innerHTML.trim()==='<br>') return;
        // <div> ou <p> → paragraphe séparé
        if(node.nodeName==='DIV'||node.nodeName==='P'){
          // Cas spécial : div avec un seul noeud texte géant
          if(node.childNodes.length===1 && node.childNodes[0].nodeType===3){
            const txt = node.childNodes[0].textContent;
            // Si le texte contient des \n, c'est plusieurs paragraphes fusionnés
            const lines = txt.split('\n').filter(l=>l.trim());
            if(lines.length > 1){
              lines.forEach(line=>{
                const pPr='<w:ind w:firstLine="720"/><w:spacing w:after="200"/>';
                paras.push(x('w:p',{},x('w:pPr',{},pPr)+
                  x('w:r',{},x('w:rPr',{},'<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/>')+
                  x('w:t',{'xml:space':'preserve'},esc2(line.trim())))));
              });
              return;
            }
          }
          const runs=nodeToRuns(node);
          if(!runs.trim()) return;
          const pPr='<w:ind w:firstLine="720"/><w:spacing w:after="200"/>';
          paras.push(x('w:p',{},x('w:pPr',{},pPr)+runs));
          return;
        }
        // Autre élément (span, b, etc.)
        const runs=nodeToRuns(node);
        if(!runs.trim()) return;
        const pPr=indentFirst?'<w:ind w:firstLine="720"/><w:spacing w:after="200"/>':'<w:spacing w:after="200"/>';
        paras.push(x('w:p',{},x('w:pPr',{},pPr)+runs));
      });
      return paras.length?paras:[x('w:p',{},x('w:pPr',{},'<w:spacing w:after="200"/>'))];
    }

    // ── Bâtir le document.xml ──
    let body='';

    // Page de titre
    const titreRun=x('w:r',{},
      x('w:rPr',{},'<w:b/><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="56"/>') +
      x('w:t',{},esc2(P.titre||''))
    );
    body+=x('w:p',{},x('w:pPr',{},'<w:jc w:val="center"/><w:spacing w:after="240" w:before="2400"/>') + titreRun);

    if(P.sousTitre){
      body+=x('w:p',{},
        x('w:pPr',{},'<w:jc w:val="center"/><w:spacing w:after="960"/>') +
        x('w:r',{},x('w:rPr',{},'<w:i/><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="28"/><w:color w:val="6b5a4e"/>') + x('w:t',{},esc2(P.sousTitre)))
      );
    } else {
      body+=x('w:p',{},x('w:pPr',{},'<w:spacing w:after="960"/>'));
    }
    if(P.auteur){
      body+=x('w:p',{},
        x('w:pPr',{},'<w:jc w:val="center"/><w:spacing w:after="120"/>') +
        x('w:r',{},x('w:rPr',{},'<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/>') + x('w:t',{},esc2(P.auteur)))
      );
    }
    const meta=[P.genre,P.annee].filter(Boolean).join(' · ');
    if(meta){
      body+=x('w:p',{},
        x('w:pPr',{},'<w:jc w:val="center"/>') +
        x('w:r',{},x('w:rPr',{},'<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="18"/><w:color w:val="9c8878"/>') + x('w:t',{},esc2(meta)))
      );
    }

    // Chapitres
    P.chapitres.forEach((ch,ci)=>{
      const niv = ch.niveau || 2;
      const headingStyle = niv === 1 ? 'Heading1' : 'Heading2';
      body+=x('w:p',{},
        x('w:pPr',{},
          `<w:pStyle w:val="${headingStyle}"/>` +
          '<w:pageBreakBefore/>' +
          '<w:spacing w:before="0" w:after="480"/>'
        ) +
        x('w:r',{},x('w:t',{},esc2(ch.titre)))
      );
      // Contenu (Titre 1 = section sans contenu propre)
      if(ch.contenu){
        const paras=htmlToParagraphs(ch.contenu, true);
        body+=paras.join('');
      }
    });

    const docXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>
${body}
<w:sectPr>
  <w:pgSz w:w="12240" w:h="15840"/>
  <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
</w:sectPr>
</w:body>
</w:document>`;

    // ── Assembler le ZIP ──
    const zip=new JSZip();
    zip.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);
    zip.file('_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    zip.file('word/document.xml', docXml);
    zip.file('word/_rels/document.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
    zip.file('word/styles.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/>
      <w:sz w:val="24"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:outlineLvl w:val="0"/>
      <w:jc w:val="center"/>
      <w:spacing w:before="2400" w:after="480"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/>
      <w:b/>
      <w:sz w:val="56"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr>
      <w:outlineLvl w:val="1"/>
      <w:pageBreakBefore/>
      <w:spacing w:before="0" w:after="480"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/>
      <w:b/>
      <w:sz w:val="32"/>
      <w:color w:val="3C2810"/>
    </w:rPr>
  </w:style>
</w:styles>`);

    const blob=await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    dl(blob,(P.titre||'roman').replace(/\s+/g,'_')+'.docx');
    flash('Export .docx terminé ✓');
  } catch(err){
    alert('Erreur export : '+err.message);
  } finally {
    btn.textContent='→ .docx'; btn.disabled=false;
  }
}

// ── Utilitaires ───────────────────────────────────────────
function dl(blob,name){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=name; a.click();
}

function rom(n){
  const v=[1000,900,500,400,100,90,50,40,10,9,5,4,1];
  const s=['M','CM','D','CD','C','XC','L','XL','X','IX','V','IV','I'];
  let r='';
  for(let i=0;i<v.length;i++) while(n>=v[i]){r+=s[i];n-=v[i];}
  return r;
}

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function flash(msg){
  const el=document.getElementById('s-msg');
  if(el){
    el.textContent=msg; el.classList.add('flash');
    clearTimeout(el._t); el._t=setTimeout(()=>{ el.textContent=''; el.classList.remove('flash'); },2500);
  }
  // Toast mobile ou dashboard
  const toast = document.getElementById('mobile-toast') || document.getElementById('db-toast');
  if(toast){
    toast.textContent = msg;
    toast.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(()=>toast.classList.remove('on'), 2000);
  } else if(!el) {
    // Fallback si aucun élément de toast trouvé
    console.log('Flash:', msg);
  }
}

function updateStatus(){ document.getElementById('s-titre').textContent=P.titre; }

// Ctrl+S
document.addEventListener('keydown',e=>{ if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();sauvegarderCloud();} });

// Autosave toutes les 2 minutes si des chapitres sont modifiés
if(_EDITEUR){
  setInterval(()=>{
    if(sbUser && P.projet_cloud_id && P.chapitres.some(ch=>ch._dirty)){
      sauvegarderCloud();
    }
  }, 2 * 60 * 1000);
}


// ── CONFIG SUPABASE ───────────────────────────────────────
// Remplace ces deux valeurs par celles de ton projet Supabase
// Settings → API → Project URL et anon/public key
const SUPABASE_URL = 'https://derxiavgbnkntopuavdz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlcnhpYXZnYm5rbnRvcHVhdmR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNjEwMzQsImV4cCI6MjA4OTczNzAzNH0.H5c6AO0Cs-fMKxYoO4Gm3IUUgSQ6OpdasKwOyfv7SHY';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let sbUser = null; window.__getsbUser = () => sbUser; window.__getP = () => P; window.__getchapI = () => chapI; window.__getsb = () => sb;

// ── INIT AUTH ─────────────────────────────────────────────
async function initAuth(){
  const { data:{ session } } = await sb.auth.getSession();
  if(session?.user){
    sbUser = session.user;
    afficherApp();
  }
  // Refresh auto de session
  sb.auth.onAuthStateChange((_event, session)=>{
    sbUser = session?.user || null;
    if(!sbUser){ document.getElementById('login-screen').classList.remove('hidden'); }
  });
}

async function afficherApp(){
  const loginScreen = document.getElementById('login-screen');
  if(loginScreen) loginScreen.classList.add('hidden');
  const badge = document.getElementById('user-badge');
  if(badge) badge.textContent = (sbUser?.email?.split('@')[0]||'') + ' ☁';

  // Lier user_id dans collaborateurs pour cet utilisateur (RLS permet à l'user de modifier ses propres lignes par email)
  if(sbUser?.id && sbUser?.email){
    sb.from('collaborateurs')
      .update({ user_id: sbUser.id })
      .eq('email', sbUser.email)
      .is('user_id', null)
      .then(({error}) => { if(error) console.warn('collab link:', error.message); });
  }
  if(_INDEX){
    // Charger le pseudo du profil
    const { data: profilData } = await sb.from('profils').select('pseudo').eq('user_id', sbUser.id).maybeSingle();
    window._pseudoProfil = profilData?.pseudo || sbUser?.email?.split('@')[0] || '';
    document.getElementById('db-user').textContent = window._pseudoProfil;
    // Afficher le bouton lien profil
    const btnProfil = document.getElementById('btn-lien-profil');
    if(btnProfil) btnProfil.style.display = '';
    ouvrirDashboard();
    // Pré-calculer _statsJours au chargement pour que exporterCalendrier soit prêt
    majStatsProfilCloud();
    // Recharger les projets quand on revient sur cet onglet (après une sauvegarde dans l'éditeur)
    // Mais seulement si ça fait plus de 30s qu'on est parti, pour éviter le reload constant
    let _lastVisible = Date.now();
    document.addEventListener('visibilitychange', () => {
      if(document.visibilityState === 'visible'){
        const elapsed = Date.now() - _lastVisible;
        if(elapsed > 300000){ // 5 minutes minimum entre deux rechargements
          chargerTousProjets(true); // silencieux — garde l'affichage existant
          majStatsProfilCloud();
        }
      } else {
        _lastVisible = Date.now();
        // Auto-save cloud quand on quitte l'onglet (switch tab, fermeture)
        if(_EDITEUR && sbUser && P.projet_cloud_id && P.chapitres.some(ch => ch._dirty === true)){
          save(); // capturer le chapitre actif
          sauvegarderCloud();
        }
      }
    });
  }
  // Pour les projets locaux (sans cloud), résoudre immédiatement
  if(_EDITEUR && !P.projet_cloud_id){
    _snapshotOuverture = P.chapitres.reduce((s,c) => s + (c.mots||0), 0);
    _collabPretResolve();
  }

  // Sur editeur.html : initialiser la collab maintenant que sbUser est connu
  if(_EDITEUR && P.projet_cloud_id){
    (async()=>{
      const uid = sbUser.id;
      const today = aujourdhui();

      // Lire ce qui est déjà enregistré aujourd'hui dans stats_ecriture
      const { data: statsDuJour } = await sb.from('stats_ecriture')
        .select('mots')
        .eq('user_id', uid)
        .eq('projet_id', P.projet_cloud_id)
        .eq('date', today)
        .maybeSingle();
      _motsDejaAujourdhui = statsDuJour?.mots || 0;

      // Recharger les chapitres depuis Supabase pour avoir auteur_id à jour
      const { data: projetFrais } = await sb.from('projets')
        .select('contenu,user_id').eq('id', P.projet_cloud_id).single();
      if(projetFrais?.contenu?.chapitres){
        projetFrais.contenu.chapitres.forEach(ch => {
          const local = P.chapitres.find(c => c.id === ch.id);
          if(local && ch.auteur_id) local.auteur_id = ch.auteur_id;
        });
      }
      // Détecter collab
      if(projetFrais && projetFrais.user_id !== sbUser.id){
        P._collab = true;
      } else {
        const { data: collabs } = await sb.from('collaborateurs')
          .select('id').eq('projet_id', P.projet_cloud_id).eq('accepte', true).limit(1);
        if(collabs && collabs.length > 0) P._collab = true;
      }
      if(P._collab){
        const uid2 = sbUser.id;
        P._mesChapitres = P.chapitres
          .filter(ch => ch.auteur_id === uid2 || !ch.auteur_id)
          .map(ch => ch.id);
        P._totalMotsSauve = P.chapitres
          .filter(ch => P._mesChapitres.includes(ch.id))
          .reduce((s,ch)=>s+(ch.mots||0),0);
        const statsUser = P.stats?.[uid] || {};
        P._totalMotsHier = Object.entries(statsUser)
          .filter(([d]) => d < today && d.length === 10)
          .reduce((s,[,m]) => s + (typeof m === 'number' ? m : 0), 0);
        // Baseline = total de mes chapitres maintenant
        _baselineSession = P.chapitres
          .filter(ch => P._mesChapitres.includes(ch.id))
          .reduce((s,ch) => s + (ch.mots||0), 0);

        // Vérifier si on a déjà des stats aujourd'hui — si oui, utiliser total_mots comme snapshot
        const { data: statsAujourd } = await sb.from('stats_ecriture')
          .select('mots, total_mots')
          .eq('user_id', uid)
          .eq('projet_id', P.projet_cloud_id)
          .eq('date', today)
          .maybeSingle();
        if(statsAujourd?.total_mots){
          // On a déjà sauvegardé aujourd'hui — le snapshot = total_mots sauvegardé
          _snapshotOuverture = statsAujourd.total_mots;
          _motsDejaAujourdhui = statsAujourd.mots;
        } else {
          _snapshotOuverture = _baselineSession;
        }
      } else {
        // Solo : baseline = total projet maintenant (mémoire, pas Supabase)
        _baselineSession = P.chapitres.reduce((s,c) => s + (c.mots||0), 0);
        _snapshotOuverture = _baselineSession;
      }

      _collabPretResolve(); // signaler que tout est prêt
      sessionStorage.setItem('encre_projet_actif', JSON.stringify({ projet: P, chapI }));
      renderSidebar();
      loadChap(chapI);
    })();
  }
}

function setSaveStatus(s){
  const el = document.getElementById('save-status');
  if(!el) return;
  const heure = new Date().toLocaleTimeString('fr-CA', {hour:'2-digit', minute:'2-digit'});
  if(s==='ok'){
    el.style.color='#4a8050';
    el.title='Sauvegardé à ' + heure;
    el.textContent='☁ ✓ ' + heure;
    // Flash vert sur le bouton Sauver mobile
    const mBtn = document.querySelector('.mnav-btn[onclick*="sauvegarderCloud"]');
    if(mBtn){
      mBtn.style.color='#4a8050';
      clearTimeout(mBtn._t);
      mBtn._t = setTimeout(()=>{ mBtn.style.color=''; }, 2000);
    }
  }
  else if(s==='err'){
    el.style.color='var(--accent)';
    el.title='Erreur de sauvegarde';
    el.textContent='☁ ✗';
  }
  else {
    el.style.color='#c4a87a';
    el.title='Non sauvegardé';
    el.textContent='☁ ●';
  }
}
function setLtStatus(s){
  const el = document.getElementById('lt-badge');
  if(!el) return;
  if(s==='ok')     { el.style.color='#4a8050'; el.title='LanguageTool actif'; }
  else if(s==='checking'){ el.style.color='#c4a87a'; el.title='LanguageTool — vérification…'; }
  else             { el.style.color='#6b5a4e'; el.title='LanguageTool — hors ligne'; }
}
function setNavActive(id){
  document.querySelectorAll('.tb-nav').forEach(b=>b.classList.remove('active'));
  if(id) document.getElementById(id)?.classList.add('active');
}

// ── LOGIN ─────────────────────────────────────────────────
async function seDeconnecter(){
  await sb.auth.signOut();
  sbUser = null;
  location.reload();
}

// Détecter si on revient d'un email de réinitialisation (index seulement)
if(_INDEX){
  (function(){
    const hash = window.location.hash;
    if(hash.includes('access_token') && hash.includes('type=recovery')){
      document.addEventListener('DOMContentLoaded', () => {
        const loginScreen = document.getElementById('login-screen');
        const resetScreen = document.getElementById('reset-screen');
        if(loginScreen) loginScreen.style.display = 'none';
        if(resetScreen) resetScreen.style.display = 'flex';
      });
    }
  })();
}

async function changerMotDePasse(){
  const pwd = document.getElementById('reset-pwd').value;
  if(!pwd || pwd.length < 6){
    document.getElementById('reset-error').textContent = 'Au moins 6 caractères.';
    return;
  }
  const { error } = await sb.auth.updateUser({ password: pwd });
  if(error){
    document.getElementById('reset-error').textContent = 'Erreur : ' + error.message;
  } else {
    document.getElementById('reset-screen').style.display = 'none';
    document.getElementById('login-screen').style.display = '';
    document.getElementById('login-error').style.color = 'var(--accent2)';
    document.getElementById('login-error').textContent = 'Mot de passe changé ! Connecte-toi.';
    // Nettoyer le hash
    history.replaceState(null, '', window.location.pathname);
  }
}

async function motDePasseOublie(){
  const email = document.getElementById('login-email').value.trim();
  if(!email){
    document.getElementById('login-error').textContent = "Entre ton courriel d'abord.";
    return;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://iletaitunefois.net/encre/index.html'
  });
  const el = document.getElementById('login-error');
  if(error){
    el.style.color = '';
    const msg = error.message.includes('invalid') 
      ? "Adresse invalide — évite les caractères accentués (é, è, à…)"
      : 'Erreur : ' + error.message;
    el.textContent = msg;
  } else {
    el.style.color = 'var(--accent2)';
    el.textContent = 'Email envoyé ! Vérifie ta boîte de courriels.';
  }
}

async function seConnecter(){
  const email = document.getElementById('login-email').value.trim();
  const pwd   = document.getElementById('login-pwd').value;
  const btn   = document.getElementById('login-btn');
  const err   = document.getElementById('login-error');
  if(!email || !pwd){ err.textContent = 'Remplis les deux champs.'; return; }
  btn.disabled = true; btn.textContent = 'Connexion…'; err.textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email, password: pwd });
  btn.disabled = false; btn.textContent = 'Se connecter';
  if(error){ err.textContent = 'Email ou mot de passe incorrect.'; return; }
  const { data:{ user } } = await sb.auth.getUser();
  sbUser = user;
  afficherApp();
}

// Entrée → soumettre
document.addEventListener('DOMContentLoaded', ()=>{
  initAuth();
  ['login-email','login-pwd'].forEach(id=>{
    document.getElementById(id)?.addEventListener('keydown', e=>{ if(e.key==='Enter') seConnecter(); });
  });
});

// ── SAUVEGARDER DANS LE CLOUD ─────────────────────────────
async function sauvegarderCloud(){
  if(!sbUser){ flash('Non connecté'); return; }
  save();
  flash('Sauvegarde…');

  // Charger les auteur_id depuis Supabase si absents en mémoire (toujours, pas juste propriétaire)
  if(P.projet_cloud_id && !P.chapitres.some(ch => ch.auteur_id)){
    const { data: projetCloud } = await sb.from('projets')
      .select('contenu').eq('id', P.projet_cloud_id).single();
    if(projetCloud?.contenu?.chapitres){
      projetCloud.contenu.chapitres.forEach(ch => {
        const local = P.chapitres.find(c => c.id === ch.id);
        if(local && ch.auteur_id) local.auteur_id = ch.auteur_id;
      });
      sessionStorage.setItem('encre_projet_actif', JSON.stringify({ projet: P, chapI }));
      // Re-appliquer le verrou visuel
      appliquerVerrouEditeur();
      renderSidebar();
    }
  }

  const estProprietaire = !P._collab;

  // ── 1. Sauvegarder les métadonnées (propriétaire seulement) ──
  if(estProprietaire){
    if(_EDITEUR) save();

    const meta = JSON.parse(JSON.stringify(P));
    meta.chapitres = meta.chapitres.map(ch => {
      const {contenu: _, ...rest} = ch;
      return {...rest, _dirty: false};
    });
    meta.projet_cloud_id = null;

    let error;
    if(P.projet_cloud_id){
      const res = await sb.from('projets')
        .update({ nom: P.titre||'Sans titre', contenu: meta, mis_a_jour: new Date().toISOString() })
        .eq('id', P.projet_cloud_id).eq('user_id', sbUser.id);
      error = res.error;
    } else {
      const res = await sb.from('projets')
        .insert({ user_id: sbUser.id, nom: P.titre||'Sans titre', contenu: meta, mis_a_jour: new Date().toISOString() })
        .select('id').single();
      error = res.error;
      if(!error && res.data) P.projet_cloud_id = res.data.id;
    }
    if(error){ flash('Erreur : ' + error.message); setSaveStatus('err'); return; }
  }

  // ── 2. Sauvegarder les chapitres modifiés (_dirty) — tous les utilisateurs ──
  if(!P.projet_cloud_id){ 
    if(!P._collab) { flash('Projet non sauvegardé dans le cloud'); return; }
  } else {
  // _dirty peut être true ou undefined (chapitres chargés depuis sessionStorage sans _dirty)
  const chapsDirty = P.chapitres.filter(ch => 
    ch._dirty === true && 
    ch.contenu !== undefined &&
    (!P._collab || !ch.auteur_id || ch.auteur_id === sbUser.id)
  );
  for(const ch of chapsDirty){
    const { error: chErr } = await sb.from('chapitres').upsert({
      projet_id: P.projet_cloud_id,
      chapitre_id: ch.id,
      contenu: ch.contenu || '',
      mots: ch.mots || 0,
      mis_a_jour: new Date().toISOString(),
      modifie_par: ch.auteur_id || sbUser.id
    }, { onConflict: 'projet_id,chapitre_id' });
    if(!chErr) {
      ch._dirty = false;
      // Effacer le backup local pour éviter que le popup "backup plus récent" revienne
      try { localStorage.removeItem(`encre_backup_${P.projet_cloud_id||'local'}_ch${ch.id}`); } catch(e) {}
    } else flash('Erreur chapitre : ' + chErr.message);
  }
  // Pour les projets solo, mettre à jour projets.contenu avec les mots actuels
  if(!P._collab && P.projet_cloud_id){
    await sb.from('projets').update({
      nom: P.titre || 'Sans titre',
      contenu: {
        ...JSON.parse(JSON.stringify(P)),
        chapitres: P.chapitres.map(ch => ({
          id: ch.id, titre: ch.titre, niveau: ch.niveau||2,
          mots: ch.mots||0, auteur_id: ch.auteur_id||null,
          notesChap: ch.notesChap||''
        })),
        projet_cloud_id: null
      },
      mis_a_jour: new Date().toISOString()
    }).eq('id', P.projet_cloud_id).eq('user_id', sbUser.id);
  }
  }

  // ── 3. Collaborateurs : mettre à jour les champs du panneau dans le contenu du projet ──
  if(P._collab && P.projet_cloud_id){
    // Lire le contenu actuel pour ne pas écraser ce qu'on ne touche pas
    const { data: projetActuel, error: readErr } = await sb.from('projets')
      .select('contenu').eq('id', P.projet_cloud_id).single();
    if(!readErr && projetActuel?.contenu){
      // Fusionner les chapitres — mettre à jour seulement ceux de l'auteur connecté
      // pour ne pas écraser les chapitres de l'autre auteur
      const chapitresActuels = projetActuel.contenu?.chapitres || [];
      const mesIds = new Set(P._mesChapitres || P.chapitres.map(ch=>ch.id));
      const chapitresFusionnes = chapitresActuels.map(ch => {
        // Si ce chapitre m'appartient, mettre à jour les mots
        if(mesIds.has(ch.id)){
          const local = P.chapitres.find(c => c.id === ch.id);
          if(local) return {...ch, mots: local.mots||0, titre: local.titre, niveau: local.niveau||2, notesChap: local.notesChap||''};
        }
        return ch;
      });
      // Ajouter les nouveaux chapitres qui n'existent pas encore dans projets.contenu
      P.chapitres.forEach(ch => {
        if(!chapitresFusionnes.find(c => c.id === ch.id)){
          chapitresFusionnes.push({id: ch.id, titre: ch.titre, niveau: ch.niveau||2, mots: ch.mots||0, auteur_id: ch.auteur_id||null, notesChap: ch.notesChap||''});
        }
      });
      const contenuMaj = {
        ...projetActuel.contenu,
        personnages: P.personnages,
        lieux: P.lieux,
        timeline: P.timeline,
        liens: P.liens||[],
        infosBase: P.infosBase||[],
        notesLibres: P.notesLibres||'',
        recherches: P.recherches||[],
        nid: P.nid,
        chapitres: chapitresFusionnes,
      };
      const { error: panelErr } = await sb.from('projets')
        .update({ contenu: contenuMaj, mis_a_jour: new Date().toISOString() })
        .eq('id', P.projet_cloud_id);
      if(panelErr) flash('Erreur panneau : ' + panelErr.message);
    }
  }

  flash('Sauvegardé ✓'); setSaveStatus('ok');

  // ── Stats du jour : calcul par chapitre (stats.js), pas par delta projet global ──
  // L'ancien calcul comparait uniquement le total du projet à un snapshot pris à
  // l'ouverture de session : déplacer du texte d'un chapitre à un autre (copier-coller,
  // ou couper-coller) fait chuter temporairement ce total, ce qui remettait le snapshot
  // à zéro et pouvait faire perdre les mots du jour déjà comptabilisés. mettreAJourStatsJour()
  // (js/stats.js) calcule le delta par chapitre à partir d'une base figée pour la journée.
  await mettreAJourStatsJour();
  // Backup sur WHC — filet de sécurité indépendant de Supabase
  try {
    fetch('https://iletaitunefois.net/encre/backup.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Encre-Token': 'encre_backup_2026_suz' },
      body: JSON.stringify({ projet_id: P.projet_cloud_id, nom: P.titre || P.nom, contenu: P })
    });
  } catch(e) { /* silencieux — backup best-effort */ }
  // Effacer TOUS les backups de ce projet après un save réussi
  // Évite les popups "backup plus récent" pour des chapitres déjà sauvegardés
  try {
    const prefix = `encre_backup_${P.projet_cloud_id||'local'}_`;
    Object.keys(localStorage)
      .filter(k => k.startsWith(prefix))
      .forEach(k => localStorage.removeItem(k));
  } catch(e) {}
  renderSidebar();
  // Mettre à jour le sessionStorage pour rester en sync
  sessionStorage.setItem('encre_projet_actif', JSON.stringify({ projet: P, chapI }));
  majStatsProfilCloud();
}

async function majStatsProfilCloud(){
  if(!sbUser) return;
  // Récupérer tous les projets pour agréger
  const { data: projets } = await sb.from('projets')
    .select('id,nom,contenu,public')
    .eq('user_id', sbUser.id);
  if(!projets) return;

  // Lire toutes les stats depuis stats_ecriture (source unique fiable)
  const { data: statsEcriture } = await sb.from('stats_ecriture')
    .select('date,mots,projet_id')
    .eq('user_id', sbUser.id);

  let totalMots = 0;
  const statsJours = {};
  let objectifEnCours = null;
  const projetsPublics = [];

  // Agréger les stats par date depuis stats_ecriture
  (statsEcriture||[]).forEach(row => {
    if(typeof row.mots === 'number'){
      statsJours[row.date] = (statsJours[row.date]||0) + row.mots;
    }
  });

  // Pour les dates sans stats_ecriture (ancien format dans projets.contenu.stats)
  // On lit l'ancien format en fallback pour ne pas perdre l'historique
  projets.forEach(row=>{
    const c = row.contenu||{};
    const mots = (c.chapitres||[]).reduce((s,ch)=>s+(ch.mots||0),0);
    if(c.stats){
      const uid = sbUser?.id || 'local';
      // Nouveau format : stats[uid][date]
      const userStats = c.stats[uid] || {};
      Object.entries(userStats).forEach(([d,m])=>{
        if(typeof m === 'number')
          statsJours[d] = (statsJours[d]||0) + m;
      });
      // Ancien format : stats[date] — seulement si pas de clé UUID
      const aNouveauFormat = Object.keys(c.stats).some(k => k.length === 36);
      const aAncienFormat  = Object.keys(c.stats).some(k => k.length === 10);
      if(aAncienFormat && !aNouveauFormat){
        Object.entries(c.stats).forEach(([d,m])=>{
          if(typeof m === 'number')
            statsJours[d] = (statsJours[d]||0) + m;
        });
      }
    }
    // Objectif du projet actif
    if(row.id === P.projet_cloud_id && c.echeance?.objectif){
      objectifEnCours = { titre: c.titre||row.nom, mots, objectif: c.echeance.objectif, fin: c.echeance.fin||null };
    }
    // Projets publics
    if(row.public){
      projetsPublics.push({ id: row.id, nom: row.nom, mots, genre: c.genre||'', annee: c.annee||'', synopsis: c.synopsis||'', couverture: c.echeance?.couverture||null, archive: c.archive||false });
    }
  });

  // totalMots = somme de tous les jours trackés
  totalMots = Object.values(statsJours).reduce((s,v)=>s+v, 0);

  // Calculer le streak
  const streak = calculerStreak(statsJours);

  // Stocker pour exporterCalendrier
  window._statsJours = statsJours;
  const statsPayload = { totalMots, statsJours, objectifEnCours, streak, projetsPublics, mis_a_jour: new Date().toISOString() };
  await sb.from('profils')
    .upsert({ user_id: sbUser.id, stats: statsPayload }, { onConflict: 'user_id' });
}

function calculerStreak(statsJours){
  const aujourd = new Date();
  let streak = 0;
  for(let i=0; i<365; i++){
    const d = new Date(aujourd);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0,10);
    if(statsJours[key] > 0) streak++;
    else if(i > 0) break; // on tolère aujourd'hui vide
  }
  return streak;
}

async function toggleProjetPublic(id, e){
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
async function ouvrirProjets(){
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

async function chargerProjetCloud(row){
  const projet = row.contenu || {};
  projet.projet_cloud_id = row.id;
  if(!projet.nid) projet.nid = 100;

  // Charger les contenus depuis la table chapitres
  const { data: chapsData } = await sb.from('chapitres')
    .select('chapitre_id,contenu,mots,modifie_par')
    .eq('projet_id', row.id);

  const chMap = {};
  (chapsData||[]).forEach(c => { chMap[c.chapitre_id] = c; });

  const aDesChapitresCloud = Object.keys(chMap).length > 0;

  (projet.chapitres||[]).forEach(ch => {
    if(chMap[ch.id]){
      // Nouveau format — contenu dans la table chapitres
      ch.contenu = chMap[ch.id].contenu || '';
      ch.mots = chMap[ch.id].mots || ch.mots || 0;
      ch._modifie_par = chMap[ch.id].modifie_par;
    } else if(!aDesChapitresCloud){
      // Ancien format — le contenu est encore dans projets.contenu
      ch._dirty = true;
    } else {
      // Nouveau format mais chapitre pas encore sauvegardé séparément
      if(ch.contenu) ch._dirty = true;
    }
  });

  // Ajouter les chapitres créés par des collaborateurs (dans chapitres mais pas dans projets.contenu)
  // Seulement si ils ont du contenu réel ET n'ont pas été supprimés
  const supprimés = new Set(projet._chapsSupprimés||[]);
  const idsExistants = new Set((projet.chapitres||[]).map(ch => ch.id));
  Object.entries(chMap).forEach(([idStr, c]) => {
    const id = parseInt(idStr);
    if(!idsExistants.has(id) && !supprimés.has(id) && c.contenu && c.contenu.trim()){
      projet.chapitres = projet.chapitres || [];
      projet.chapitres.push({
        id,
        titre: 'Chapitre ' + (projet.chapitres.length + 1),
        contenu: c.contenu || '',
        mots: c.mots || 0,
        niveau: 2,
        _modifie_par: c.modifie_par
      });
    }
  });

  // Réparer chapitres fusionnés (contenu texte brut)
  (projet.chapitres||[]).forEach(ch => {
    if(!ch.contenu) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = ch.contenu;
    const kids = Array.from(tmp.childNodes);
    if(kids.length===1 && kids[0].nodeType===3){
      const paras = kids[0].textContent.split('\n').filter(s=>s.trim());
      if(paras.length>1) ch.contenu = paras.map(p=>`<div>${p}</div>`).join('');
    }
  });

  // Marquer si c'est un projet partagé (propriétaire OU collaborateur)
  const { data: ownership } = await sb.from('projets')
    .select('user_id').eq('id', row.id).single();
  if(ownership && ownership.user_id !== sbUser.id){
    projet._collab = true;
  } else {
    const { data: collabs } = await sb.from('collaborateurs')
      .select('id').eq('projet_id', row.id).eq('accepte', true).limit(1);
    if(collabs && collabs.length > 0) projet._collab = true;
  }

  // S'assurer que nid est plus grand que tous les IDs existants — évite les collisions entre collabs
  const maxId = (projet.chapitres||[]).reduce((m,ch)=>Math.max(m,ch.id||0),0);
  if(projet.nid <= maxId) projet.nid = maxId + 1;

  // Baseline pour le compteur de mots
  const uid2 = sbUser?.id || 'local';
  const today2 = aujourdhui();
  const statsUser = projet.stats?.[uid2] || {};
  projet._totalMotsHier = Object.entries(statsUser)
    .filter(([d]) => d < today2 && d.length === 10)
    .reduce((s,[,m]) => s + (typeof m === 'number' ? m : 0), 0);

  if(projet._collab){
    const uid = sbUser?.id;
    projet._mesChapitres = (projet.chapitres||[])
      .filter(ch => ch.auteur_id === uid || (!ch.auteur_id && true))
      .map(ch => ch.id);
    projet._totalMotsSauve = (projet.chapitres||[])
      .filter(ch => projet._mesChapitres.includes(ch.id))
      .reduce((s,ch)=>s+(ch.mots||0),0);
  } else {
    projet._totalMotsSauve = (projet.chapitres||[]).reduce((s,ch)=>s+(ch.mots||0),0);
  }

  sessionStorage.setItem('encre_projet_actif', JSON.stringify({ projet, chapI: 0 }));
  window.location.href = 'editeur.html';
}


async function supprimerProjetCloud(id, e){
  e.stopPropagation();
  if(!confirm('Supprimer ce projet du cloud ?')) return;
  await Promise.all([
    sb.from('chapitres').delete().eq('projet_id', id),
    sb.from('verrous').delete().eq('projet_id', id),
    sb.from('stats_ecriture').delete().eq('projet_id', id),
    sb.from('collaborateurs').delete().eq('projet_id', id),
    sb.from('commentaires').delete().eq('projet_id', id)
  ]);
  const { error } = await sb.from('projets').delete().eq('id', id).eq('user_id', sbUser.id);
  if(error){ flash('Erreur suppression'); return; }
  ouvrirProjets();
}


// ── CRÉATION PROJET DEPUIS LE DASHBOARD ───────────────────
function ouvrirCreationProjet(){
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

function fermerCreation(){
  document.getElementById('creation-modal').style.display = 'none';
}

async function creerProjetDashboard(){
  const titre = document.getElementById('cr-titre').value.trim();
  if(!titre){ document.getElementById('cr-titre').focus(); return; }

  const contenu = {
    titre,
    auteur:    document.getElementById('cr-auteur').value.trim(),
    sousTitre: document.getElementById('cr-sous').value.trim(),
    genre:     document.getElementById('cr-genre').value.trim(),
    annee:     document.getElementById('cr-annee').value.trim(),
    synopsis:  document.getElementById('cr-synopsis').value.trim(),
    chapitres: [{ id:1, titre:'Chapitre I', contenu:'', mots:0, auteur_id: sbUser.id }],
    personnages:[], lieux:[], timeline:[], recherches:[], nid:2,
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

async function getStatsSource(){
  const sel = document.getElementById('stats-projet-select')?.value;
  const merged = {};
  const uid = sbUser?.id;
  if(!uid) return merged;

  // Lire depuis la nouvelle table stats_ecriture
  let query = sb.from('stats_ecriture').select('date, mots, projet_id').eq('user_id', uid);
  if(sel && sel !== '_all') query = query.eq('projet_id', sel);
  const { data: rows } = await query;
  (rows||[]).forEach(r => {
    merged[r.date] = (merged[r.date]||0) + r.mots;
  });

  // Fusionner les stats manuelles — toujours additionner par-dessus les stats éditeur
  if((!sel || sel === '_all') && window._statsManuelles){
    Object.entries(window._statsManuelles).forEach(([cle, total]) => {
      if(typeof total !== 'number') return;
      // Clé quotidienne (2026-06-08) → utiliser telle quelle
      // Clé mensuelle (2026-06) → mettre au 1er du mois
      const dateKey = cle.length === 10 ? cle : (cle.length === 7 ? cle + '-01' : null);
      if(dateKey) merged[dateKey] = (merged[dateKey]||0) + total;
    });
  }

  return merged;
}

// ── Navigation calendrier ────────────────────────────────────────────────────
let _calOffset = 0;

function calNavMois(delta){
  _calOffset += delta;
  if(_calOffset > 0) _calOffset = 0;
  renderStats();
}

function _updateCalLabel(){
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + _calOffset, 1);
  const label = d.toLocaleString('fr-FR',{month:'long',year:'numeric'});
  const el = document.getElementById('cal-mois-label');
  if(el) el.textContent = label.charAt(0).toUpperCase() + label.slice(1);
  const next = document.getElementById('cal-nav-next');
  if(next) next.disabled = _calOffset >= 0;
}

async function renderStats(){
  const stats = await getStatsSource();
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
  const isCurrentMonth = refMois.getFullYear()===now.getFullYear() && refMois.getMonth()===now.getMonth();
  const dernierDuMois = new Date(refMois.getFullYear(), refMois.getMonth()+1, 0).getDate();
  const jourActuel = now.getDate();
  const jours = [];
  for(let j=1; j<=dernierDuMois; j++){
    const cle = `${refMois.getFullYear()}-${String(refMois.getMonth()+1).padStart(2,'0')}-${String(j).padStart(2,'0')}`;
    const isFuture = isCurrentMonth && j > jourActuel;
    jours.push({ label: (isCurrentMonth && j===jourActuel)?'Auj':String(j), mots: stats[cle]||0, isToday: isCurrentMonth && j===jourActuel, isFuture });
  }
  const maxMots = Math.max(...jours.map(j=>j.mots), 1);
  const linScale = v => v > 0 ? v / maxMots : 0;
  const moisLabel = refMois.toLocaleString('fr-FR',{month:'long',year:'numeric'});
  // Sur mobile : liste verticale des jours écrits seulement
  const isMobile = window.innerWidth <= 600;
  if(isMobile){
    const joursEcrits = jours.filter(j => j.mots > 0);
    if(joursEcrits.length === 0){
      chart.innerHTML = `<div style="font-family:'Crimson Pro',serif;font-size:14px;color:var(--ink4);font-style:italic;padding:8px 0">Aucun mot ce mois-ci.</div>`;
    } else {
      const maxM = Math.max(...joursEcrits.map(j=>j.mots));
      chart.innerHTML = `
        <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ink4);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">${moisLabel}</div>
        ${joursEcrits.map(j => {
          const pct = Math.round((j.mots/maxM)*100);
          const couleur = j.isToday ? 'var(--accent2)' : 'var(--accent)';
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
            <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ink4);width:24px;text-align:right;flex-shrink:0">${j.label}</div>
            <div style="flex:1;height:14px;background:var(--paper3);border-radius:2px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:${couleur};border-radius:2px;transition:width .3s;"></div>
            </div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ink3);width:40px;flex-shrink:0">${j.mots.toLocaleString('fr-FR')}</div>
          </div>`;
        }).join('')}`;
    }
  } else {
    chart.innerHTML=`
    <div style="position:relative;">
    <div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:var(--ink4);text-transform:uppercase;letter-spacing:.06em;position:absolute;top:-14px;right:0;">${moisLabel}</div>
    <div class="barchart-inner">
      ${jours.map((j,idx)=> {
        const showLabel = j.isToday || [1,5,10,15,20,25,31].includes(idx+1);
        const showAttr = showLabel ? ' data-show-label' : '';
        return j.isFuture
          ? `<div class="bar-col"${showAttr}><div class="bar-fill future" style="height:2px"></div><div class="bar-label" style="opacity:.35">${j.label}</div></div>`
          : `<div class="bar-col"${showAttr}><div class="bar-fill${j.isToday?' today':''}" style="height:${j.mots>0?Math.max(3,Math.round(linScale(j.mots)*100))+'%':'2px'}">${j.mots>0?`<span class="bar-tip">${j.mots.toLocaleString('fr-FR')} mots</span>`:''}</div><div class="bar-label">${j.label}</div></div>`;
      }).join('')}
    </div>`;
  }

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
  const now = new Date();
  const moisCle = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const statsMois = Object.fromEntries(Object.entries(stats).filter(([d])=>d.startsWith(moisCle)));
  const maxJour = Math.max(...Object.values(statsMois), 0);
  const joursEcrits = Object.values(statsMois).filter(m=>m>0).length;

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

function exporterCalendrier(moisPrecedent = false){
  const now = new Date();
  // Si mois précédent demandé, reculer d'un mois
  const offsetExport = moisPrecedent ? _calOffset - 1 : _calOffset;
  const ref = new Date(now.getFullYear(), now.getMonth() + offsetExport, 1);
  const annee = ref.getFullYear();
  const mois = ref.getMonth();
  // Pas de "aujourd'hui" si on exporte un mois passé ou si c'est le dernier jour du mois
  const dernierJour = new Date(annee, mois + 1, 0).getDate();
  const exportMoisCourant = annee === now.getFullYear() && mois === now.getMonth();
  const desactiverAujourd = moisPrecedent || !exportMoisCourant || now.getDate() === dernierJour;
  const parseDate = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };
  const moisNom = ref.toLocaleString('fr-FR',{month:'long',year:'numeric'});
  const moisNomCap = moisNom.charAt(0).toUpperCase() + moisNom.slice(1);

  // Collecter stats du mois depuis _statsJours (source unique = stats_ecriture)
  const stats = {};
  const source = window._statsJours || {};
  Object.entries(source).forEach(([date, mots]) => {
    const d = parseDate(date);
    if(d.getFullYear()===annee && d.getMonth()===mois)
      stats[d.getDate()] = (stats[d.getDate()]||0) + mots;
  });

  const total = Object.values(stats).reduce((s,v)=>s+v,0);
  const nbJoursEcrits = Object.values(stats).filter(v=>v>0).length;
  const nbJoursMois = new Date(annee, mois+1, 0).getDate();
  const meilleurJour = Math.max(...Object.values(stats), 0);

  // Objectif du mois
  const objectif = P.echeance?.objectif || null;
  const totalProjet = (P.chapitres||[]).reduce((s,c)=>s+(c.mots||0),0);

  // ── Canvas 1080×1350 (portrait 4:5) ──────────────────────
  const W = 1080, H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Fond crème
  ctx.fillStyle = '#f5f0e8';
  ctx.fillRect(0, 0, W, H);

  // ── BANDE TITRE ───────────────────────────────────────────
  const grad = ctx.createLinearGradient(0,0,W,0);
  grad.addColorStop(0, '#2c2416');
  grad.addColorStop(1, '#4a3828');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 160);

  ctx.fillStyle = '#c4922a';
  ctx.font = 'italic 48px Georgia, serif';
  ctx.textAlign = 'left';
  ctx.fillText("l'Encrier", 60, 72);

  ctx.fillStyle = '#e8e0d0';
  ctx.font = '600 34px Georgia, serif';
  ctx.textAlign = 'right';
  ctx.fillText(moisNomCap, W-60, 72);

  ctx.fillStyle = '#8c7b6e';
  ctx.font = 'italic 22px Georgia, serif';
  ctx.textAlign = 'left';
  ctx.fillText('Journal d\'écriture', 60, 118);

  // ── STATS — 3 blocs ───────────────────────────────────────
  const statsY = 182;
  const blocH = 140;
  const pad = 24;
  const nb = objectif ? 4 : 3;
  const blocW = Math.floor((W - pad*(nb+1)) / nb);

  const blocs = [
    { label: 'mots ce mois', val: total.toLocaleString('fr-FR'), couleur: '#8b6914' },
    { label: `jours écrits / ${nbJoursMois}`, val: String(nbJoursEcrits), couleur: '#6b4f12' },
    { label: 'meilleure journée', val: meilleurJour.toLocaleString('fr-FR'), couleur: '#c4922a' },
  ];
  if(objectif){
    const pct = Math.min(100, Math.round(totalProjet/objectif*100));
    blocs.push({ label: 'objectif manuscrit', val: pct+'%', couleur: '#5a3d0e' });
  }

  blocs.forEach((b, i) => {
    const bx = pad + i*(blocW+pad);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.roundRect(bx, statsY, blocW, blocH, 14); ctx.fill();
    // Barre couleur en haut
    ctx.fillStyle = b.couleur;
    ctx.beginPath(); ctx.roundRect(bx, statsY, blocW, 5, [14,14,0,0]); ctx.fill();
    // Valeur
    ctx.fillStyle = b.couleur;
    ctx.font = 'bold 44px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(b.val, bx+blocW/2, statsY+78);
    // Label
    ctx.fillStyle = '#8c7b6e';
    ctx.font = 'italic 18px Georgia, serif';
    ctx.fillText(b.label, bx+blocW/2, statsY+112);
  });

  // Barre de progression objectif
  let afterStatsY = statsY + blocH + 16;
  if(objectif){
    const pct = Math.min(1, totalProjet/objectif);
    const barX = pad, barW = W - pad*2, barH = 14;
    ctx.fillStyle = '#e0d8cc';
    ctx.beginPath(); ctx.roundRect(barX, afterStatsY, barW, barH, 7); ctx.fill();
    const fg = ctx.createLinearGradient(barX,0,barX+barW*pct,0);
    fg.addColorStop(0,'#8b6914'); fg.addColorStop(1,'#c4922a');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.roundRect(barX, afterStatsY, barW*pct, barH, 7); ctx.fill();
    afterStatsY += 40;
  }

  // ── CALENDRIER — centre ───────────────────────────────────
  const calPadX = 40;
  const COLS = 7;
  const cellW2 = Math.floor((W - calPadX*2) / COLS);
  const cellH2 = 134;
  const cellPad = 6;
  const joursLabels = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

  const calY = afterStatsY + 20;

  // En-têtes jours
  ctx.font = 'bold 18px monospace';
  ctx.fillStyle = '#a09080';
  joursLabels.forEach((j,i)=>{
    ctx.textAlign='center';
    ctx.fillText(j.toUpperCase(), calPadX + i*cellW2 + cellW2/2, calY+22);
  });

  const premierJour = new Date(annee,mois,1);
  const debutCol = (premierJour.getDay()+6)%7;
  const nbJours = nbJoursMois;
  const maxVal = Math.max(...Object.values(stats), 1);
  const nbSemaines = Math.ceil((debutCol + nbJours) / 7);

  for(let j=1; j<=nbJours; j++){
    const idx = debutCol + j - 1;
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const cx = calPadX + col*cellW2;
    const cy = calY + 36 + row*cellH2;
    const v = stats[j]||0;
    const isToday = !desactiverAujourd && j===now.getDate() && exportMoisCourant;

    // Fond de cellule — intensité selon mots
    let bg;
    if(isToday){
      bg = '#2c2416';
    } else if(v > 0){
      const alpha = 0.18 + (v/maxVal)*0.62;
      bg = null; // dégradé
      ctx.save();
      const cellGrad = ctx.createLinearGradient(cx+cellPad, cy+cellPad, cx+cellW2-cellPad, cy+cellH2-cellPad);
      cellGrad.addColorStop(0, `rgba(139,105,20,${alpha+0.1})`);
      cellGrad.addColorStop(1, `rgba(196,146,42,${alpha})`);
      ctx.fillStyle = cellGrad;
      ctx.beginPath(); ctx.roundRect(cx+cellPad, cy+cellPad, cellW2-cellPad*2, cellH2-cellPad*2, 12); ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = '#ede8de';
      ctx.beginPath(); ctx.roundRect(cx+cellPad, cy+cellPad, cellW2-cellPad*2, cellH2-cellPad*2, 12); ctx.fill();
    }

    if(isToday){
      ctx.fillStyle = '#2c2416';
      ctx.beginPath(); ctx.roundRect(cx+cellPad, cy+cellPad, cellW2-cellPad*2, cellH2-cellPad*2, 12); ctx.fill();
    }

    // Numéro du jour — haut gauche
    ctx.fillStyle = isToday ? '#c4922a' : (v>0 ? '#fff' : '#b0a090');
    ctx.font = `${isToday?'bold ':''} 24px monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(j, cx+cellPad+10, cy+cellPad+28);

    // Nombre de mots — centré verticalement
    if(v > 0){
      ctx.fillStyle = isToday ? '#e8d5a0' : '#fff';
      ctx.font = 'bold 30px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(v.toLocaleString('fr-FR'), cx+cellW2/2, cy+cellH2/2+14);
      ctx.fillStyle = isToday ? '#8c7b6e' : 'rgba(255,255,255,0.7)';
      ctx.font = '14px monospace';
      ctx.fillText('mots', cx+cellW2/2, cy+cellH2/2+34);
    }
  }

  // ── GRAPHIQUE BARRES — bas ────────────────────────────────
  const graphY = calY + 36 + nbSemaines*cellH2 + 30;
  const graphH = 160;
  const graphX = calPadX;
  const graphW = W - calPadX*2;
  const barW2 = Math.floor((graphW - (nbJours-1)*3) / nbJours);
  const maxGraph = Math.max(...Object.values(stats), 1);

  // Ligne de base
  ctx.strokeStyle = '#d8d0c4';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(graphX, graphY+graphH);
  ctx.lineTo(graphX+graphW, graphY+graphH);
  ctx.stroke();

  for(let j=1; j<=nbJours; j++){
    const v = stats[j]||0;
    const bh = Math.max(3, v/maxGraph * graphH);
    const bx = graphX + (j-1)*(barW2+3);
    const isToday = !desactiverAujourd && j===now.getDate() && exportMoisCourant;

    ctx.fillStyle = isToday ? '#c4922a' : (v>0 ? '#8b6914' : '#e0d8cc');
    ctx.beginPath();
    ctx.roundRect(bx, graphY+graphH-bh, barW2, bh, [3,3,0,0]);
    ctx.fill();

    // Numéro — seulement tous les 5 jours pour ne pas surcharger
    if(j===1 || j%5===0 || j===nbJours || isToday){
      ctx.fillStyle = isToday ? '#c4922a' : '#a09080';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(j, bx+barW2/2, graphY+graphH+22);
    }
  }

  // ── PIED ──────────────────────────────────────────────────
  ctx.fillStyle = '#2c2416';
  ctx.fillRect(0, H-60, W, 60);
  ctx.fillStyle = '#c4922a';
  ctx.font = 'italic 24px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('iletaitunefois.net', W/2, H-20);

  // Export
  canvas.toBlob(blob=>{
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`encre_${annee}-${String(mois+1).padStart(2,'0')}_instagram.png`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  },'image/png');
}

function peuplerSelectStats(){
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

async function ouvrirDashboard(){
  if(_EDITEUR){ window.location.href = 'index.html'; return; }
  const carnetPage = document.getElementById('carnet-page');
  if(carnetPage) carnetPage.style.display='none';
  if(typeof planMode!=='undefined' && planMode) togglePlan();
  document.getElementById('dashboard').classList.add('on');
  const topbar = document.getElementById('topbar');
  if(topbar) topbar.style.display='none';
  const app = document.getElementById('app');
  if(app) app.style.display='none';
  const _sb=document.getElementById('sb'); if(_sb) _sb.style.display='none';
  setNavActive('nav-projets');
  // pseudo + projets en parallèle
  const [{ data: profilData }] = await Promise.all([
    sb.from('profils').select('pseudo').eq('user_id', sbUser.id).maybeSingle(),
    chargerTousProjets()
  ]);
  window._pseudoProfil = profilData?.pseudo || sbUser?.email?.split('@')[0] || '';
  document.getElementById('db-user').textContent = window._pseudoProfil;
  majStatsProfilCloud();
}

function fermerDashboard(){
  document.getElementById('dashboard').classList.remove('on');
  const topbar = document.getElementById('topbar');
  if(topbar) topbar.style.display='';
  const _ap2=document.getElementById('app'); if(_ap2) _ap2.style.display='';
  const _sb2=document.getElementById('sb'); if(_sb2) _sb2.style.display='';
  setNavActive(null);
}

function ouvrirCarnetPage(){
  if(planMode) togglePlan();
  document.getElementById('dashboard')?.classList.remove('on');
  const _tb=document.getElementById('topbar'); if(_tb) _tb.style.display='none';
  const _ap=document.getElementById('app'); if(_ap) _ap.style.display='none';
  const _sb=document.getElementById('sb'); if(_sb) _sb.style.display='none';
  const _cp2=document.getElementById('carnet-page'); if(_cp2) _cp2.style.display='flex';
  setNavActive('nav-carnet');
  if(carnetActif !== null) renderCarnetEditor(carnetActif);
  else renderCarnetList();
}

function fermerCarnetPage(){
  const _cp=document.getElementById('carnet-page'); if(_cp) _cp.style.display='none';
  const _tb2=document.getElementById('topbar'); if(_tb2) _tb2.style.display='';
  const _ap2=document.getElementById('app'); if(_ap2) _ap2.style.display='';
  const _sb2=document.getElementById('sb'); if(_sb2) _sb2.style.display='';
  setNavActive(null);
}

async function chargerTousProjets(silencieux = false){
  if(!sbUser) return;
  const grid = document.getElementById('db-projets-grid');
  // Ne pas vider la grille si on a déjà des données (retour sur l'onglet)
  if(!silencieux || !dbProjets?.length){
    grid.innerHTML = '<div style="font-family:\'Crimson Pro\',serif;font-size:14px;color:var(--ink4);padding:8px 0;grid-column:1/-1">Chargement…</div>';
  }

  // Toutes les requêtes en une seule vague — évite 3 allers-retours réseau en cascade
  const [
    { data, error },
    { data: profilStats },
    { data: collabCounts },
    { data: parId },
    { data: parEmail }
  ] = await Promise.all([
    sb.from('projets').select('id,nom,mis_a_jour,contenu,public').eq('user_id', sbUser.id).order('mis_a_jour', { ascending: false }),
    sb.from('profils').select('stats_manuelles').eq('user_id', sbUser.id).maybeSingle(),
    sb.from('collaborateurs').select('projet_id').eq('invite_par', sbUser.id),
    sb.from('collaborateurs').select('projet_id,chapitres_assignes,role,projets(id,nom,contenu,mis_a_jour,public)').eq('user_id', sbUser.id),
    sb.from('collaborateurs').select('projet_id,chapitres_assignes,role,projets(id,nom,contenu,mis_a_jour,public)').eq('email', sbUser.email)
  ]);

  window._statsManuelles = profilStats?.stats_manuelles || {};
  if(error){ grid.innerHTML = '<div style="color:var(--accent)">Erreur : '+error.message+'</div>'; return; }

  // Count des collaborateurs invités
  const countMap = {};
  (collabCounts||[]).forEach(c => { countMap[c.projet_id] = (countMap[c.projet_id]||0) + 1; });

  // Projets partagés (dédupliqués)
  const vus = new Set();
  const partages = [...(parId||[]), ...(parEmail||[])].filter(c => {
    if(!c.projets || vus.has(c.projet_id)) return false;
    vus.add(c.projet_id);
    return true;
  }).map(c => ({ ...c.projets, _collab: true, _chapitres_assignes: c.chapitres_assignes, _role: c.role }));

  const tousIds = new Set((data||[]).map(r=>r.id));
  const partagesNouveaux = partages.filter(p=>!tousIds.has(p.id));
  const tousRows = [...(data||[]), ...partagesNouveaux];
  tousRows.forEach(r => { r._collabCount = countMap[r.id] || 0; });
  // Trier : projets actifs récemment (mots cette semaine) en premier,
  // puis par échéance, puis par date de modification
  const maintenantMs = Date.now();
  const SEMAINE = 7 * 24 * 60 * 60 * 1000;
  const actifRecemment = (p) => {
    const d = new Date(p.mis_a_jour).getTime();
    return (maintenantMs - d) < SEMAINE;
  };
  dbProjets = tousRows.sort((a,b)=>{
    const aActif = actifRecemment(a);
    const bActif = actifRecemment(b);
    // Projets actifs cette semaine en premier
    if(aActif && !bActif) return -1;
    if(!aActif && bActif) return 1;
    // Entre deux projets actifs : plus récent en premier
    if(aActif && bActif) return new Date(b.mis_a_jour) - new Date(a.mis_a_jour);
    // Entre deux projets inactifs : par échéance puis par date
    const fa = a.contenu?.echeance?.fin;
    const fb = b.contenu?.echeance?.fin;
    if(fa && fb) return new Date(fa) - new Date(fb);
    if(fa) return -1;
    if(fb) return 1;
    return new Date(b.mis_a_jour) - new Date(a.mis_a_jour);
  });
  renderDashboard();
}


function renderDashboard(){
  renderGreeting();
  renderDbGrid();
  renderGantt();
  peuplerSelectStats();
  renderStats();
}

async function renderGreeting(){
  const el = document.getElementById('db-greeting');
  if(!el) return;
  const h = new Date().getHours();
  const prenom = window._pseudoProfil || sbUser?.email?.split('@')[0] || '';
  const salut = h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';

  // Mots écrits aujourd'hui — depuis la nouvelle table stats_ecriture
  const today = aujourdhui();
  const uid = sbUser?.id || 'local';
  let motsAujourdhui = 0;
  if(sbUser){
    const { data: statsToday } = await sb.from('stats_ecriture')
      .select('mots')
      .eq('user_id', uid)
      .eq('date', today);
    // Sommer les mots — exclure les valeurs aberrantes (> 10000 par projet = bug de stats)
    motsAujourdhui = (statsToday||[]).reduce((s,r)=> s + Math.min(r.mots, 10000), 0);
  }
  // Ajouter les mots manuels d'aujourd'hui
  if(window._statsManuelles){
    const todayManuel = window._statsManuelles[today];
    if(typeof todayManuel === 'number') motsAujourdhui += todayManuel;
  }

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
  correction:'#c4622d', relecture:'#6b8a3a', editeur:'#4a8050', pause:'#6b5a4e',
  termine_ecriture:'#4a8050', termine_correction:'#4a8050'
};
const STATUT_LABELS = {
  idee:'Idée', ecriture:'Écriture', beta:'Bêta-lecture', reecriture:'Réécriture',
  correction:'Correction', relecture:'Relecture finale', editeur:'Envoi à l\'éditeur', pause:'En pause',
  termine_ecriture:'✓ Terminé (écriture)', termine_correction:'✓ Terminé (correction)'
};

function renderDbGrid(){
  const grid = document.getElementById('db-projets-grid');
  grid.innerHTML = '';

  const actifs = dbProjets.filter(r => !r.contenu?.archive);
  const archives = dbProjets.filter(r => r.contenu?.archive);

  const renderCard = (row) => {
    const c = row.contenu || {};
    const mots = (c.chapitres||[]).reduce((s,ch)=>s+(ch.mots||0),0);
    const objectif = c.echeance?.objectif || 0;
    const pct = objectif ? Math.min(100, Math.round(mots/objectif*100)) : null;
    const statut = c.echeance?.statut || 'idee';
    const fin = c.echeance?.fin;
    const estActif = P.projet_cloud_id === row.id;
    let echeanceHtml = '';

    const pub = c.echeance?.publication;
    let pubHtml = '';
    if(pub){
      const pubDate = new Date(pub);
      const isPast = pubDate < new Date();
      pubHtml = `<div style="font-family:'JetBrains Mono',monospace;font-size:9px;margin-top:3px;color:${isPast?'#4a8050':'var(--gold)'}">📖 ${pubDate.toLocaleDateString('fr-CA')}</div>`;
    }
    if(fin && !statut.startsWith('termine')){
      const diff = Math.ceil((new Date(fin) - new Date()) / 86400000);
      const cls = diff < 0 ? 'urgent' : diff < 14 ? 'bientot' : 'ok';
      const txt = diff < 0 ? `En retard de ${-diff}j` : diff === 0 ? 'Aujourd\'hui !' : `Dans ${diff} jours`;
      echeanceHtml = `<div class="db-card-echeance ${cls}">${txt} — ${new Date(fin).toLocaleDateString('fr-CA')}</div>`;
    } else if(fin && statut.startsWith('termine')){
      echeanceHtml = `<div class="db-card-echeance ok">Terminé — ${new Date(fin).toLocaleDateString('fr-CA')}</div>`;
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
      <div style="margin-top:10px;display:flex;gap:5px;flex-wrap:wrap">
        ${c.archive
          ? `<button onclick="reactiverProjet('${row.id}',event)" style="flex:1;padding:5px;background:var(--accent);border:none;border-radius:4px;color:#fff;font-family:'Crimson Pro',serif;font-size:12px;cursor:pointer">↩ Réactiver</button>`
          : `<button onclick="ouvrirDepuisDash('${row.id}',event)" style="flex:1;min-width:60px;padding:5px;background:var(--accent);border:none;border-radius:4px;color:#fff;font-family:'Crimson Pro',serif;font-size:12px;cursor:pointer">Ouvrir</button>
        <button onclick="ouvrirEcheance('${row.id}',event)" style="flex:1;min-width:60px;padding:5px;background:none;border:1px solid var(--paper3);border-radius:4px;color:var(--ink3);font-family:'Crimson Pro',serif;font-size:12px;cursor:pointer">Échéances</button>`
        }
        <div style="display:flex;gap:5px;flex-shrink:0">
          ${!c.archive ? `<button onclick="archiverProjet('${row.id}',event)" title="Archiver ce projet" style="padding:5px 7px;background:none;border:1px solid var(--paper3);border-radius:4px;color:var(--ink3);font-size:13px;cursor:pointer">📦</button>` : ''}
          <button onclick="ouvrirCommentairesDash('${row.id}','${row.nom}',event)" style="padding:5px 7px;background:none;border:1px solid var(--paper3);border-radius:4px;color:var(--ink3);font-size:13px;cursor:pointer" id="btn-comm-${row.id}" title="Commentaires">💬</button>
          <button onclick="toggleProjetPublic('${row.id}',event)" title="${row.public?'Retirer du profil public':'Afficher sur le profil public'}" style="padding:5px 7px;background:none;border:1px solid var(--paper3);border-radius:4px;color:${row.public?'var(--gold)':'var(--ink3)'};font-size:13px;cursor:pointer">${row.public?'🌐':'🔒'}</button>
          <button onclick="ouvrirCollabModal('${row.id}',event)" title="${row._collabCount ? row._collabCount+' collaborateur(s)' : 'Collaborateurs'}" style="padding:5px 7px;background:none;border:1px solid ${row._collabCount ? '#4a8050' : 'var(--paper3)'};border-radius:4px;color:${row._collabCount ? '#4a8050' : 'var(--ink3)'};font-size:13px;cursor:pointer">👥</button>
          ${row.id ? `<button onclick="copierLienLecture('${row.id}',event)" title="Copier le lien de lecture bêta" style="padding:5px 7px;background:none;border:1px solid var(--paper3);border-radius:4px;color:var(--ink3);font-size:13px;cursor:pointer">📖</button>` : ''}
        </div>
      </div>`;
    grid.appendChild(card);
  };

  actifs.forEach(renderCard);

  // Carte nouveau projet
  const newCard = document.createElement('div');
  newCard.className = 'db-new-card';
  newCard.innerHTML = '＋ Nouveau projet';
  newCard.onclick = ouvrirCreationProjet;
  grid.appendChild(newCard);

  // Section projets archivés
  if(archives.length){
    const sep = document.createElement('div');
    sep.style.cssText = 'width:100%;grid-column:1/-1;margin-top:24px;margin-bottom:8px;border-top:1px solid var(--paper3);padding-top:20px;';
    sep.innerHTML = `<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-family:'JetBrains Mono',monospace;color:var(--ink4);">Projets archivés</div>`;
    grid.appendChild(sep);
    archives.forEach(renderCard);
  }
}

// ── Gantt drag state ─────────────────────────────────────
let _ganttDrag = null; // { rowId, type:'move'|'left'|'right', startX, origDebut, origFin, minDate, totalMs, trackW }

function renderGantt(){
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

    const pubDot = e.publication ? (()=>{
      const pPct = Math.max(0, Math.min(100, (new Date(e.publication)-minDate)/totalMs*100));
      const dateStr = new Date(e.publication).toLocaleDateString('fr-CA');
      return `<div style="position:absolute;top:50%;left:${pPct}%;transform:translate(-50%,-50%);width:12px;height:12px;border-radius:50%;background:#4a8050;border:2px solid #fff;cursor:default;z-index:2;" title="Publication : ${dateStr}"></div>`;
    })() : '';

    const debutStr = debut.toLocaleDateString('fr-CA');
    const finStr   = fin.toLocaleDateString('fr-CA');

    html += `<div class="gantt-row" data-id="${row.id}">
      <div class="gantt-label" title="${row.nom}" ondblclick="ouvrirEcheance('${row.id}',event)" style="cursor:pointer">${row.nom}</div>
      <div class="gantt-track" data-mindate="${minDate.getTime()}" data-totalms="${totalMs}">
        <div class="gantt-today" style="left:${(today-minDate)/totalMs*100}%"></div>
        <div class="gantt-bar" data-id="${row.id}" data-debut="${debut.getTime()}" data-fin="${fin.getTime()}"
             style="left:${left}%;width:${width}%;background:${color};position:absolute;top:50%;transform:translateY(-50%);height:60%;border-radius:4px;display:flex;align-items:center;box-sizing:border-box;user-select:none;"
             title="${debutStr} → ${finStr}">
          <div class="gantt-handle gantt-handle-left" data-id="${row.id}" data-type="left"
               style="position:absolute;left:0;top:0;width:10px;height:100%;cursor:w-resize;z-index:3;border-radius:3px 0 0 3px;"></div>
          <span style="padding:0 10px;font-family:'JetBrains Mono',monospace;font-size:9px;color:#fff;pointer-events:none;overflow:hidden;white-space:nowrap;">
            ${width > 4 ? row.nom : ''}
          </span>
          <div class="gantt-handle gantt-handle-right" data-id="${row.id}" data-type="right"
               style="position:absolute;right:0;top:0;width:10px;height:100%;cursor:e-resize;z-index:3;border-radius:0 3px 3px 0;"></div>
        </div>
        ${pubDot}
      </div>
    </div>`;
  });

  gantt.innerHTML = html;

  // Tooltip flottant pour les dates pendant le drag
  if(!document.getElementById('gantt-tooltip')){
    const tt = document.createElement('div');
    tt.id = 'gantt-tooltip';
    tt.style.cssText = 'position:fixed;background:var(--ink1);color:var(--paper2);padding:4px 10px;border-radius:6px;font-family:"JetBrains Mono",monospace;font-size:11px;pointer-events:none;z-index:9999;display:none;';
    document.body.appendChild(tt);
  }

  // Attacher les événements drag
  gantt.querySelectorAll('.gantt-handle').forEach(handle=>{
    handle.addEventListener('mousedown', ganttHandleMouseDown);
  });
  gantt.querySelectorAll('.gantt-bar').forEach(bar=>{
    bar.addEventListener('mousedown', ganttBarMouseDown);
    bar.addEventListener('dblclick', e=>{
      if(e.target.classList.contains('gantt-handle')) return;
      ouvrirEcheance(bar.dataset.id, e);
    });
  });
}

function ganttHandleMouseDown(e){
  e.stopPropagation(); e.preventDefault();
  const id = e.currentTarget.dataset.id;
  const type = e.currentTarget.dataset.type; // 'left' ou 'right'
  _ganttStartDrag(e, id, type);
}

function ganttBarMouseDown(e){
  // Ignorer si clic sur une poignée
  if(e.target.classList.contains('gantt-handle')) return;
  e.preventDefault();
  const id = e.currentTarget.dataset.id;
  _ganttStartDrag(e, id, 'move');
}

function _ganttStartDrag(e, id, type){
  const row = dbProjets.find(r=>r.id===id);
  if(!row) return;
  const ech = row.contenu?.echeance || {};
  const bar = document.querySelector(`.gantt-bar[data-id="${id}"]`);
  const track = bar.closest('.gantt-track');
  const trackRect = track.getBoundingClientRect();

  _ganttDrag = {
    id, type,
    startX: e.clientX,
    trackLeft: trackRect.left,
    trackW: trackRect.width,
    minDate: parseInt(track.dataset.mindate),
    totalMs: parseInt(track.dataset.totalms),
    origDebut: ech.debut ? new Date(ech.debut).getTime() : parseInt(bar.dataset.debut),
    origFin:   ech.fin   ? new Date(ech.fin).getTime()   : parseInt(bar.dataset.fin),
  };

  document.addEventListener('mousemove', ganttOnMouseMove);
  document.addEventListener('mouseup',   ganttOnMouseUp);
  document.body.style.cursor = type === 'move' ? 'grabbing' : 'ew-resize';
}

function ganttOnMouseMove(e){
  if(!_ganttDrag) return;
  const { id, type, startX, trackW, minDate, totalMs, origDebut, origFin } = _ganttDrag;
  const dx = e.clientX - startX;
  const dMs = (dx / trackW) * totalMs;
  const MS_DAY = 86400000;

  let newDebut = origDebut;
  let newFin   = origFin;

  if(type === 'move'){
    newDebut = origDebut + dMs;
    newFin   = origFin   + dMs;
  } else if(type === 'left'){
    newDebut = Math.min(origDebut + dMs, origFin - MS_DAY * 7); // min 7j
  } else if(type === 'right'){
    newFin = Math.max(origFin + dMs, origDebut + MS_DAY * 7);
  }

  // Snap au jour
  newDebut = Math.round(newDebut / MS_DAY) * MS_DAY;
  newFin   = Math.round(newFin   / MS_DAY) * MS_DAY;

  // Mettre à jour visuellement la barre
  const bar = document.querySelector(`.gantt-bar[data-id="${id}"]`);
  if(!bar) return;
  const left  = Math.max(0, (newDebut - minDate) / totalMs * 100);
  const width = Math.max(0.5, (newFin - newDebut) / totalMs * 100);
  bar.style.left  = left + '%';
  bar.style.width = width + '%';
  bar.dataset.debut = newDebut;
  bar.dataset.fin   = newFin;

  // Tooltip
  const tt = document.getElementById('gantt-tooltip');
  if(tt){
    const d1 = new Date(newDebut).toLocaleDateString('fr-CA');
    const d2 = new Date(newFin).toLocaleDateString('fr-CA');
    tt.textContent = type==='left' ? `Début : ${d1}` : type==='right' ? `Fin : ${d2}` : `${d1} → ${d2}`;
    tt.style.display = 'block';
    tt.style.left = (e.clientX + 12) + 'px';
    tt.style.top  = (e.clientY - 28) + 'px';
  }
}

async function ganttOnMouseUp(e){
  if(!_ganttDrag) return;
  document.removeEventListener('mousemove', ganttOnMouseMove);
  document.removeEventListener('mouseup',   ganttOnMouseUp);
  document.body.style.cursor = '';
  const tt = document.getElementById('gantt-tooltip');
  if(tt) tt.style.display = 'none';

  const { id } = _ganttDrag;
  const bar = document.querySelector(`.gantt-bar[data-id="${id}"]`);
  if(!bar){ _ganttDrag = null; return; }

  const newDebut = new Date(parseInt(bar.dataset.debut));
  const newFin   = new Date(parseInt(bar.dataset.fin));
  const toISO    = d => d.toISOString().slice(0,10);

  // Mettre à jour dans dbProjets
  const row = dbProjets.find(r=>r.id===id);
  if(row){
    if(!row.contenu.echeance) row.contenu.echeance = {};
    row.contenu.echeance.debut = toISO(newDebut);
    row.contenu.echeance.fin   = toISO(newFin);

    // Sauvegarder dans Supabase
    const { error } = await sb.from('projets')
      .update({ contenu: row.contenu, mis_a_jour: new Date().toISOString() })
      .eq('id', id).eq('user_id', sbUser.id);

    if(error){ flash('Erreur sauvegarde : ' + error.message); }
    else { flash('Échéances mises à jour ✓'); }
  }

  _ganttDrag = null;
}

// ── ÉCHÉANCES ─────────────────────────────────────────────
let echCouvTmp = null;

function ouvrirEcheance(id, e){
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
  // Étapes
  const et = ech.etapes || {};
  document.getElementById('ech-etape-debut').value = et.debut||'';
  document.getElementById('ech-etape-jet').value = et.jet||'';
  document.getElementById('ech-etape-retravail').value = et.retravail||'';
  document.getElementById('ech-etape-publication').value = et.publication||'';
  // Aperçu couverture existante
  const prev = document.getElementById('ech-couv-preview');
  prev.innerHTML = ech.couverture
    ? `<img src="${ech.couverture}" style="width:100%;max-height:140px;object-fit:cover;border-radius:5px;margin-bottom:4px">`
    : '';
  document.getElementById('echeance-modal').classList.add('on');
}

function fermerEcheance(){
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

async function sauverEcheance(){
  if(!echeanceId) return;
  const row = dbProjets.find(r=>r.id===echeanceId);
  if(!row) return;
  const ech = {
    debut:       document.getElementById('ech-debut').value,
    fin:         document.getElementById('ech-fin').value,
    publication: document.getElementById('ech-publication').value,
    statut:      document.getElementById('ech-statut').value,
    objectif:    parseInt(document.getElementById('ech-objectif').value)||0,
    couverture:  echCouvTmp !== null ? echCouvTmp : (row.contenu?.echeance?.couverture||null),
    etapes: {
      debut:       document.getElementById('ech-etape-debut').value || null,
      jet:         document.getElementById('ech-etape-jet').value || null,
      retravail:   document.getElementById('ech-etape-retravail').value || null,
      publication: document.getElementById('ech-etape-publication').value || null,
    }
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

let _commDashProjetId = null;
let _commDashNom = '';
let _commDashData = [];
let _commDashChapitres = []; // noms des chapitres pour référence
let _commDashTri = 'position'; // 'position' ou 'date'

async function ouvrirCommentairesDash(id, nom, e){
  e.stopPropagation();
  _commDashProjetId = id;
  _commDashNom = nom;
  _commDashTri = 'position';
  document.getElementById('comm-dash-titre').textContent = `Commentaires — ${nom}`;
  document.getElementById('comm-dash-list').innerHTML = '<div style="padding:20px;font-family:\'Crimson Pro\',serif;color:var(--ink4);font-style:italic">Chargement…</div>';
  document.getElementById('comm-dash-footer').style.display = 'none';
  document.getElementById('comm-dash-tri').style.display = 'none';
  document.getElementById('comm-dash-modal').classList.add('on');

  // Charger commentaires + chapitres du projet en parallèle
  const [commRes, projRes] = await Promise.all([
    sb.from('commentaires').select('*').eq('projet_id', id),
    sb.from('projets').select('contenu').eq('id', id).single()
  ]);

  _commDashData = commRes.data || [];
  _commDashChapitres = projRes.data?.contenu?.chapitres?.map(ch => ch.titre || 'Sans titre') || [];

  if(commRes.error || !_commDashData.length){
    document.getElementById('comm-dash-list').innerHTML = '<div style="padding:24px 20px;font-family:\'Crimson Pro\',serif;font-size:15px;color:var(--ink4);font-style:italic;text-align:center">Aucun commentaire pour l\'instant.</div>';
    return;
  }
  document.getElementById('comm-dash-tri').style.display = 'flex';
  majTriBoutons();
  renderCommDash();
  document.getElementById('comm-dash-footer').style.display = 'flex';
}

function trierCommentairesDash(mode){
  _commDashTri = mode;
  majTriBoutons();
  renderCommDash();
}

function majTriBoutons(){
  document.getElementById('tri-position-btn')?.classList.toggle('active', _commDashTri==='position');
  document.getElementById('tri-date-btn')?.classList.toggle('active', _commDashTri==='date');
}

function renderCommDash(){
  const list = document.getElementById('comm-dash-list');
  list.innerHTML = '';
  if(!_commDashData.length) return;

  // Séparer parents et réponses
  const parents = _commDashData.filter(c => !c.parent_id);
  const reponses = _commDashData.filter(c => c.parent_id);

  let tries;
  if(_commDashTri === 'position'){
    tries = [...parents].sort((a,b) => {
      if(a.chapitre_idx !== b.chapitre_idx) return a.chapitre_idx - b.chapitre_idx;
      if(a.paragraphe_idx !== b.paragraphe_idx) return a.paragraphe_idx - b.paragraphe_idx;
      return new Date(a.cree_le) - new Date(b.cree_le);
    });
  } else {
    tries = [...parents].sort((a,b) => new Date(b.cree_le) - new Date(a.cree_le));
  }

  // Grouper par chapitre si tri par position
  let dernierChapitre = -1;
  tries.forEach(c => {
    // En-tête de chapitre si tri par position et nouveau chapitre
    if(_commDashTri === 'position' && c.chapitre_idx !== dernierChapitre){
      dernierChapitre = c.chapitre_idx;
      const header = document.createElement('div');
      header.className = 'comm-dash-chapitre';
      header.textContent = _commDashChapitres[c.chapitre_idx] || ('Chapitre ' + (c.chapitre_idx+1));
      list.appendChild(header);
    }

    const item = document.createElement('div');
    item.className = 'comm-dash-item';
    const date = new Date(c.cree_le).toLocaleDateString('fr-CA');

    // Réponses à ce commentaire
    const reps = reponses.filter(r => r.parent_id === c.id);
    const repsHTML = reps.length > 0
      ? `<div style="margin-top:8px;padding-left:10px;border-left:2px solid var(--paper3);">${reps.map(r => {
          const rd = new Date(r.cree_le).toLocaleDateString('fr-CA');
          return `<div style="margin-bottom:6px;">
            <span class="comm-dash-auteur" style="font-size:8px">${r.auteur}</span>
            <span style="font-size:12px;color:var(--ink)">${r.texte}</span>
            <span class="comm-dash-date">${rd}</span>
          </div>`;
        }).join('')}</div>` : '';

    // Référence au paragraphe si tri par date
    const refChap = _commDashTri === 'date' && _commDashChapitres[c.chapitre_idx]
      ? `<span style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--ink4);margin-left:8px;">${_commDashChapitres[c.chapitre_idx]} · §${(c.paragraphe_idx||0)+1}</span>`
      : (_commDashTri === 'position' ? `<span style="font-family:'JetBrains Mono',monospace;font-size:8px;color:var(--ink4);margin-left:8px;">§${(c.paragraphe_idx||0)+1}</span>` : '');

    item.innerHTML = `
      <div class="comm-dash-body">
        <div class="comm-dash-auteur">${c.auteur}${refChap}</div>
        ${c.contexte ? `<div class="comm-dash-ctx">«\u00a0${c.contexte}\u00a0»</div>` : ''}
        <div class="comm-dash-texte">${c.texte}</div>
        <div class="comm-dash-date">${date}</div>
        ${repsHTML}
      </div>
      <button class="comm-dash-del" onclick="supprimerComm('${c.id}',this)" title="Supprimer">✕</button>`;
    list.appendChild(item);
  });
}

function fermerCommentairesDash(){
  document.getElementById('comm-dash-modal').classList.remove('on');
}

async function supprimerComm(id, btn){
  if(!confirm('Supprimer ce commentaire ?')) return;
  const { error } = await sb.from('commentaires').delete().eq('id', id);
  if(error){ alert('Erreur : ' + error.message); return; }
  _commDashData = _commDashData.filter(c => c.id !== id);
  if(!_commDashData.filter(c => !c.parent_id).length){
    document.getElementById('comm-dash-list').innerHTML = '<div style="padding:24px 20px;font-family:\'Crimson Pro\',serif;font-size:15px;color:var(--ink4);font-style:italic;text-align:center">Aucun commentaire.</div>';
    document.getElementById('comm-dash-tri').style.display = 'none';
  } else {
    renderCommDash();
  }
}

function exporterCommentaires(){
  if(!_commDashData.length) return;

  // Séparer parents et réponses
  const parents = _commDashData.filter(c => !c.parent_id);
  const reponses = _commDashData.filter(c => c.parent_id);

  // Trier par position dans le texte
  const tries = [...parents].sort((a,b) => {
    if(a.chapitre_idx !== b.chapitre_idx) return a.chapitre_idx - b.chapitre_idx;
    if(a.paragraphe_idx !== b.paragraphe_idx) return a.paragraphe_idx - b.paragraphe_idx;
    return new Date(a.cree_le) - new Date(b.cree_le);
  });

  let dernierChapitre = -1;
  const lignes = tries.map(c => {
    let bloc = '';
    // En-tête de chapitre
    if(c.chapitre_idx !== dernierChapitre){
      dernierChapitre = c.chapitre_idx;
      const nomChap = _commDashChapitres[c.chapitre_idx] || ('Chapitre ' + (c.chapitre_idx+1));
      bloc += `\n${'═'.repeat(40)}\n${nomChap}\n${'═'.repeat(40)}\n\n`;
    }
    const date = new Date(c.cree_le).toLocaleDateString('fr-CA');
    const ctx = c.contexte ? `  « ${c.contexte} »\n` : '';
    const ref = `§${(c.paragraphe_idx||0)+1}`;
    bloc += `[${date}] ${c.auteur}  (${ref})\n${ctx}${c.texte}`;
    // Ajouter les réponses
    const reps = reponses.filter(r => r.parent_id === c.id);
    if(reps.length){
      reps.forEach(r => {
        const rd = new Date(r.cree_le).toLocaleDateString('fr-CA');
        bloc += `\n  ↩ ${r.auteur} [${rd}] : ${r.texte}`;
      });
    }
    bloc += `\n${'─'.repeat(40)}`;
    return bloc;
  }).join('\n');

  const contenu = `Commentaires — ${_commDashNom}\nExporté le ${new Date().toLocaleDateString('fr-CA')}\n(triés par ordre d'apparition dans le texte)\n${lignes}`;
  const blob = new Blob([contenu], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `commentaires-${_commDashNom.replace(/[^a-z0-9]/gi,'-').toLowerCase()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

async function toutEffacerCommentaires(){
  if(!_commDashProjetId) return;
  if(!confirm(`Effacer tous les commentaires de "${_commDashNom}" ? Cette action est irréversible.`)) return;
  const { error } = await sb.from('commentaires').delete().eq('projet_id', _commDashProjetId);
  if(error){ flash('Erreur : ' + error.message); return; }
  _commDashData = [];
  document.getElementById('comm-dash-list').innerHTML = '<div style="padding:24px 20px;font-family:\'Crimson Pro\',serif;font-size:15px;color:var(--ink4);font-style:italic;text-align:center">Aucun commentaire.</div>';
  document.getElementById('comm-dash-footer').style.display = 'none';
  document.getElementById('comm-dash-tri').style.display = 'none';
  // Mettre à jour le badge sur la carte projet
  const btn = document.getElementById('btn-comm-' + _commDashProjetId);
  if(btn) btn.style.color = '';
  flash('Commentaires effacés 🗑');
}

async function copierLienLecture(projetId, e){
  e?.stopPropagation();
  // Activer le partage si pas déjà fait
  if(sbUser){
    await sb.from('projets').update({ partage: true }).eq('id', projetId).eq('user_id', sbUser.id);
  }
  const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
  const lien = `${base}lecture.html?p=${projetId}`;
  window.open(lien, '_blank');
}

function copierLienProfil(){
  if(!sbUser?.id) return;
  const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
  const lien = `${base}profil.html?u=${sbUser.id}`;
  // Méthode universelle — fonctionne sur iOS Safari aussi
  const tmp = document.createElement('textarea');
  tmp.value = lien;
  tmp.style.position = 'fixed';
  tmp.style.opacity = '0';
  document.body.appendChild(tmp);
  tmp.focus();
  tmp.select();
  document.execCommand('copy');
  document.body.removeChild(tmp);
  flash('Lien copié ✓');
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
  const base = window.location.href.replace(/\/[^/]*$/, '/');
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

function copierLienProfilModal(){
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
  // Préserver stats_manuelles existantes — ne jamais les écraser avec upsert
  if(window._statsManuelles && Object.keys(window._statsManuelles).length > 0){
    profil.stats_manuelles = window._statsManuelles;
  }
  const { error } = await sb.from('profils').upsert(profil, { onConflict: 'user_id' });
  if(error){ alert('Erreur : '+error.message); return; }
  flash('Profil sauvegardé ✓');
  fermerModalProfil();
}

function ouvrirDepuisDash(id, e){
  e.stopPropagation();
  const row = dbProjets.find(r=>r.id===id);
  if(!row) return;
  chargerProjetCloud(row);
  fermerDashboard();
}

async function archiverProjet(id, e){
  e?.stopPropagation();
  const row = dbProjets.find(r => r.id === id);
  if(!row) return;
  // Étape 1 : confirmer l'archivage — Annuler ici = rien ne se passe
  if(!confirm(`Archiver "${row.nom}" ?\n\nLe projet sera déplacé dans la section Archives.`)) return;
  // Étape 2 : demander si on garde le contenu
  const garder = confirm(`Garder le texte des chapitres ?\n\nOK = garder le contenu\nAnnuler = vider le contenu (garder les stats seulement)`);
  const contenu = { ...row.contenu, archive: true };
  if(!garder){
    // Vider le contenu dans projets.contenu — garder mots pour les stats
    contenu.chapitres = (contenu.chapitres||[]).map(ch => ({...ch, contenu:'', mots: ch.mots||0}));
    // Vider aussi la table chapitres (où le vrai texte est stocké)
    const { error: errChap } = await sb.from('chapitres')
      .update({ contenu: '' })
      .eq('projet_id', id);
    if(errChap) console.warn('Erreur vidage chapitres:', errChap.message);
  }
  const { error } = await sb.from('projets').update({ contenu, mis_a_jour: new Date().toISOString() }).eq('id', id);
  if(error){ flash('Erreur : ' + error.message); return; }
  row.contenu = contenu;
  renderDbGrid();
  flash('Projet archivé 📦');
}

async function reactiverProjet(id, e){
  e?.stopPropagation();
  const row = dbProjets.find(r => r.id === id);
  if(!row) return;
  const contenu = { ...row.contenu };
  delete contenu.archive;
  const { error } = await sb.from('projets').update({ contenu, mis_a_jour: new Date().toISOString() }).eq('id', id);
  if(error){ flash('Erreur : ' + error.message); return; }
  row.contenu = contenu;
  renderDbGrid();
  flash('Projet réactivé ✓');
}

async function supprimerProjetDash(id, e){
  e.stopPropagation();
  const row = dbProjets.find(r=>r.id===id);
  if(!confirm(`Supprimer "${row?.nom}" du cloud ?`)) return;
  // Nettoyer d'abord les lignes liées (chapitres, verrous, stats, collaborateurs, commentaires)
  // pour éviter que la suppression du projet échoue à cause de contraintes de clé étrangère.
  await Promise.all([
    sb.from('chapitres').delete().eq('projet_id', id),
    sb.from('verrous').delete().eq('projet_id', id),
    sb.from('stats_ecriture').delete().eq('projet_id', id),
    sb.from('collaborateurs').delete().eq('projet_id', id),
    sb.from('commentaires').delete().eq('projet_id', id)
  ]);
  const { error } = await sb.from('projets').delete().eq('id', id).eq('user_id', sbUser.id);
  if(error){ alert('Erreur : '+error.message); return; }
  dbProjets = dbProjets.filter(r=>r.id!==id);
  renderDashboard();
}



// ── Verrou éditeur : applique l'état (lecture seule ou non) sur l'éditeur actif ──
function appliquerVerrouEditeur(){
  const c = P.chapitres[chapI];
  if(!c) return;
  const ed = document.getElementById('editor');
  if(!ed) return;
  const verrouxSession = _verrouxAutres?.[c.id];
  const bloqueParAuteur  = c.auteur_id && c.auteur_id !== sbUser?.id;
  const bloqueParSession = verrouxSession && verrouxSession.user_id !== sbUser?.id;
  const estMonChap = !bloqueParAuteur && !bloqueParSession;
  ed.contentEditable = estMonChap ? 'true' : 'false';
  ed.style.opacity = estMonChap ? '' : '0.65';
  ed.title = bloqueParSession
    ? `${verrouxSession.pseudo} est en train d’écrire ici…`
    : bloqueParAuteur
      ? 'Chapitre en lecture seule — appartient à un autre auteur'
      : '';
  const fmtBar = document.getElementById('fmt-bar');
  if(fmtBar){
    fmtBar.style.opacity = estMonChap ? '' : '0.3';
    fmtBar.style.pointerEvents = estMonChap ? '' : 'none';
  }
}

// ── Verrous de chapitres ──────────────────────────────────
let _verrouxLocaux = {}; // chapitre_id → true (verrous posés par moi)
let _verrouxAutres = {}; // chapitre_id → {pseudo, user_id}
let _realtimeSub = null;

async function poserVerrou(chapitreId){
  if(!sbUser || !P.projet_cloud_id) return;
  const pseudo = window._pseudoProfil || sbUser.email.split('@')[0];
  await sb.from('verrous').upsert({
    projet_id: P.projet_cloud_id,
    chapitre_id: chapitreId,
    user_id: sbUser.id,
    pseudo,
    depuis: new Date().toISOString()
  }, { onConflict: 'projet_id,chapitre_id' });
  _verrouxLocaux[chapitreId] = true;
}

async function libererVerrou(chapitreId){
  if(!sbUser || !P.projet_cloud_id) return;
  await sb.from('verrous')
    .delete()
    .eq('projet_id', P.projet_cloud_id)
    .eq('chapitre_id', chapitreId)
    .eq('user_id', sbUser.id);
  delete _verrouxLocaux[chapitreId];
}

async function libererTousVerrous(){
  if(!sbUser || !P.projet_cloud_id) return;
  await sb.from('verrous')
    .delete()
    .eq('projet_id', P.projet_cloud_id)
    .eq('user_id', sbUser.id);
  _verrouxLocaux = {};
}

async function abonnerVerrous(){
  if(_realtimeSub) sb.removeChannel(_realtimeSub);
  if(!P.projet_cloud_id) return;
  if(!sbUser?.id) return;

  // Charger les pseudos des collaborateurs pour les afficher dans la sidebar
  if(!window._pseudosCollabs) window._pseudosCollabs = {};
  const auteurIds = [...new Set(P.chapitres.map(ch => ch.auteur_id).filter(Boolean))];
  const idsInconnus = auteurIds.filter(id => id !== sbUser.id && !window._pseudosCollabs[id]);
  if(idsInconnus.length > 0){
    const { data: profils } = await sb.from('profils')
      .select('user_id, pseudo, email').in('user_id', idsInconnus);
    (profils||[]).forEach(p => {
      window._pseudosCollabs[p.user_id] = p.pseudo || p.email?.split('@')[0] || '?';
    });
  }

  // Charger les verrous existants
  const { data } = await sb.from('verrous')
    .select('*')
    .eq('projet_id', P.projet_cloud_id)
    .neq('user_id', sbUser.id);

  _verrouxAutres = {};
  (data||[]).forEach(v => { _verrouxAutres[v.chapitre_id] = { pseudo: v.pseudo, user_id: v.user_id }; });
  renderSidebar();

  // S'abonner aux verrous ET aux chapitres en temps réel
  _realtimeSub = sb.channel('collab:' + P.projet_cloud_id)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'verrous',
      filter: 'projet_id=eq.' + P.projet_cloud_id
    }, (payload) => {
      if(payload.eventType === 'INSERT' || payload.eventType === 'UPDATE'){
        const v = payload.new;
        if(v.user_id !== sbUser.id){
          _verrouxAutres[v.chapitre_id] = { pseudo: v.pseudo, user_id: v.user_id };
        }
      } else if(payload.eventType === 'DELETE'){
        const v = payload.old;
        delete _verrouxAutres[v.chapitre_id];
      }
      renderSidebar();
      // Si le chapitre ouvert est affecté, mettre à jour l'éditeur en temps réel
      appliquerVerrouEditeur();
    })
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'chapitres',
      filter: 'projet_id=eq.' + P.projet_cloud_id
    }, (payload) => _majChapitreDistant(payload.new))
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'chapitres',
      filter: 'projet_id=eq.' + P.projet_cloud_id
    }, (payload) => _majChapitreDistant(payload.new))
    .subscribe();
}

function _majChapitreDistant(chap){
  // Ignorer nos propres sauvegardes
  if(chap.modifie_par === sbUser.id) return;

  // Chercher le chapitre en mémoire
  let ch = P.chapitres.find(c => c.id === chap.chapitre_id);

  // Si nouveau chapitre (INSERT) — l'ajouter à P.chapitres
  if(!ch){
    ch = {
      id: chap.chapitre_id,
      titre: chap.titre || ('Chapitre ' + (P.chapitres.length + 1)),
      contenu: chap.contenu || '',
      mots: chap.mots || 0,
      niveau: 2
    };
    P.chapitres.push(ch);
    renderSidebar();
    flash('📄 Nouveau chapitre ajouté par un collaborateur');
    return;
  }

  ch.contenu = chap.contenu || '';
  ch.mots    = chap.mots || 0;

  // Si on est sur ce chapitre, recharger l'éditeur
  if(P.chapitres[chapI]?.id === chap.chapitre_id){
    const ed = document.getElementById('editor');
    if(ed) ed.innerHTML = ch.contenu;
    flash('✏️ Mis à jour par un collaborateur');
  }

  // Mettre à jour le total de mots après réception d'un chapitre distant
  updateWC();
  renderSidebar();
}

function estVerrouille(chapitreId){
  return _verrouxAutres[chapitreId] || null;
}

// ── Saisie manuelle de mots ───────────────────────────────
let _grilleOffset = 0; // 0 = mois courant, -1 = mois précédent

function ouvrirModalMots(){
  if(!sbUser){ flash('Non connecté'); return; }
  _grilleOffset = 0;
  switchMotsTab('jour');
  document.getElementById('mots-modal').style.display = 'flex';
}

function switchMotsTab(tab){
  const isJour = tab === 'jour';
  document.getElementById('tab-jour').style.display = isJour ? 'block' : 'none';
  document.getElementById('tab-mois').style.display = isJour ? 'none' : 'block';
  document.getElementById('tab-jour-btn').style.background = isJour ? '#8b6914' : '#f5f0e8';
  document.getElementById('tab-jour-btn').style.color = isJour ? '#fff' : '#7a6e5a';
  document.getElementById('tab-mois-btn').style.background = isJour ? '#f5f0e8' : '#4a7a5a';
  document.getElementById('tab-mois-btn').style.color = isJour ? '#7a6e5a' : '#fff';
  if(isJour) _peuplerGrilleJours();
  else _peuplerImportMois();
}

function grilleNavMois(delta){
  const now = new Date();
  const newOffset = _grilleOffset + delta;
  // Ne pas aller dans le futur ni plus de 12 mois en arrière
  if(newOffset > 0 || newOffset < -12) return;
  _grilleOffset = newOffset;
  _peuplerGrilleJours();
}

function _peuplerGrilleJours(){
  const now = new Date();
  const ref = new Date(now.getFullYear(), now.getMonth() + _grilleOffset, 1);
  const annee = ref.getFullYear();
  const mois = ref.getMonth();
  const nbJours = new Date(annee, mois + 1, 0).getDate();
  const moisFr = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

  // Label + nav arrows state
  const label = document.getElementById('grille-mois-label');
  if(label) label.textContent = `${moisFr[mois]} ${annee}`;
  const next = document.getElementById('grille-nav-next');
  if(next) next.disabled = _grilleOffset >= 0;

  const grid = document.getElementById('grille-jours');
  if(!grid) return;

  let html = '';
  for(let j = 1; j <= nbJours; j++){
    const key = `${annee}-${String(mois+1).padStart(2,'0')}-${String(j).padStart(2,'0')}`;
    // Lire valeur existante depuis stats_manuelles
    const existant = window._statsManuelles?.[key] || 0;
    const jourLabel = `${j} ${moisFr[mois].slice(0,3).toLowerCase()}.`;
    html += `<div>
      <label style="font-family:'Crimson Pro',serif;font-size:11px;color:#7a6e5a;display:block;margin-bottom:2px">${jourLabel}</label>
      <input type="number" id="grille-${key}" min="0" max="99999" placeholder="0"
        value="${existant || ''}"
        style="width:100%;padding:5px 7px;border:1px solid #d8d0c0;border-radius:4px;font-family:'Crimson Pro',serif;font-size:13px;background:#f5f0e8;">
    </div>`;
  }
  grid.innerHTML = html;
}

async function sauverGrilleJours(){
  if(!sbUser) return;
  const now = new Date();
  const ref = new Date(now.getFullYear(), now.getMonth() + _grilleOffset, 1);
  const annee = ref.getFullYear();
  const mois = ref.getMonth();
  const nbJours = new Date(annee, mois + 1, 0).getDate();

  const { data: profil } = await sb.from('profils')
    .select('stats_manuelles').eq('user_id', sbUser.id).maybeSingle();
  const statsM = profil?.stats_manuelles || {};

  let nbSauves = 0;
  for(let j = 1; j <= nbJours; j++){
    const key = `${annee}-${String(mois+1).padStart(2,'0')}-${String(j).padStart(2,'0')}`;
    const input = document.getElementById(`grille-${key}`);
    if(!input) continue;
    const val = parseInt(input.value);
    if(val > 0){
      statsM[key] = val;
      nbSauves++;
    } else if(input.value === '' || val === 0){
      delete statsM[key];
    }
  }

  const { error } = await sb.from('profils')
    .update({ stats_manuelles: statsM, mis_a_jour: new Date().toISOString() })
    .eq('user_id', sbUser.id);

  if(error){ flash('Erreur : ' + error.message); return; }
  window._statsManuelles = statsM;
  flash(`${nbSauves} jour${nbSauves > 1 ? 's' : ''} enregistré${nbSauves > 1 ? 's' : ''} ✓`);
  fermerModalMots();
  renderStats();
}

function _peuplerImportMois(){
  const now = new Date();
  const grid = document.getElementById('import-mois-grid');
  if(!grid) return;
  const moisFr = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const annee = now.getFullYear();
  let html = '';
  for(let m=0; m<=now.getMonth(); m++){
    const key = `${annee}-${String(m+1).padStart(2,'0')}`; // format YYYY-MM
    const label = `${moisFr[m]} ${annee}`;
    // Lire depuis le nouveau format YYYY-MM ou l'ancien YYYY-MM-01
    const existant = window._statsManuelles?.[key] || window._statsManuelles?.[key+'-01'] || 0;
    html += `
      <div>
        <label style="font-family:'Crimson Pro',serif;font-size:11px;color:#7a6e5a;display:block;margin-bottom:3px">${label}</label>
        <input type="number" id="imp-${key}" min="0" max="999999" placeholder="0"
          value="${existant||''}"
          style="width:100%;padding:6px 8px;border:1px solid #d8d0c0;border-radius:5px;font-family:'Crimson Pro',serif;font-size:14px;background:#f5f0e8;">
      </div>`;
  }
  grid.innerHTML = html;
}

async function sauverImportMensuel(){
  if(!sbUser) return;
  const now = new Date();
  const { data: profil } = await sb.from('profils')
    .select('stats_manuelles').eq('user_id', sbUser.id).maybeSingle();

  // Partir d'un objet propre — supprimer les anciens formats YYYY-MM-01 au passage
  const ancien = profil?.stats_manuelles || {};
  const statsM = {};
  Object.entries(ancien).forEach(([k, v]) => {
    // Convertir l'ancien format YYYY-MM-01 → YYYY-MM
    const cle = k.length === 10 && k.endsWith('-01') ? k.slice(0, 7) : k;
    statsM[cle] = v;
  });

  let nbImportes = 0;
  const annee = now.getFullYear();
  for(let m=0; m<=now.getMonth(); m++){
    const key = `${annee}-${String(m+1).padStart(2,'0')}`; // YYYY-MM
    const input = document.getElementById(`imp-${key}`);
    if(!input) continue;
    const val = parseInt(input.value);
    if(val > 0){
      statsM[key] = val;
      nbImportes++;
    } else {
      delete statsM[key];
    }
  }

  const { error } = await sb.from('profils')
    .update({ stats_manuelles: statsM, mis_a_jour: new Date().toISOString() })
    .eq('user_id', sbUser.id);

  if(error){ flash('Erreur : ' + error.message); return; }
  window._statsManuelles = statsM;
  flash(`${nbImportes} mois importés ✓`);
  fermerModalMots();
  renderStats();
}

function fermerModalMots(){
  document.getElementById('mots-modal').style.display = 'none';
}

async function sauverMotsManuels(){
  // Remplacé par sauverGrilleJours() — cette fonction n'est plus appelée
  flash('Utilisez la grille du mois pour entrer vos mots.');
}


// ── Collaboration ─────────────────────────────────────────

async function ouvrirCollabModal(projetId, e){
  e.stopPropagation();
  const row = dbProjets.find(r=>r.id===projetId);
  if(!row) return;

  // Charger les collaborateurs existants
  const { data: collabs } = await sb.from('collaborateurs')
    .select('*').eq('projet_id', projetId);

  const chapitres = (row.contenu?.chapitres||[]).filter(ch=>ch.niveau===2);

  const modal = document.getElementById('collab-modal');
  const box   = document.getElementById('collab-box');

  const listeCollabs = (collabs||[]).map(c => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--paper3);">
      <span style="flex:1;font-family:'Crimson Pro',serif;font-size:14px;color:var(--ink2)">${c.email||c.user_id}</span>
      <span style="font-size:11px;color:var(--ink4);font-style:italic">${c.chapitres_assignes ? c.chapitres_assignes.length+' chapitre(s)' : 'tous'}</span>
      <button onclick="retirerCollab('${c.id}','${projetId}')" style="background:none;border:none;cursor:pointer;color:var(--ink4);font-size:14px;" title="Retirer">✕</button>
    </div>
  `).join("") || `<div style="font-size:13px;color:var(--ink4);font-style:italic;padding:8px 0">Aucun collaborateur pour l'instant.</div>`;

  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 style="font-family:'Crimson Pro',serif;font-size:20px;color:var(--ink1);margin:0">Collaborateurs — ${row.nom}</h3>
      <button onclick="fermerCollabModal()" style="background:none;border:none;cursor:pointer;font-size:20px;color:var(--ink4)">✕</button>
    </div>
    <div style="font-size:13px;color:var(--ink3);font-style:italic;margin-bottom:16px;font-family:'Crimson Pro',serif;">
      Les chapitres se verrouillent automatiquement quand quelqu'un est en train d'écrire.
    </div>

    <div style="margin-bottom:20px">${listeCollabs}</div>

    <div style="background:#f5f0e8;border-radius:8px;padding:14px;">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3);margin-bottom:10px">Inviter quelqu'un</div>
      <label style="font-family:'Crimson Pro',serif;font-size:13px;color:var(--ink3)">Courriel</label>
      <input id="collab-email" type="email" placeholder="copine@exemple.com"
             style="width:100%;padding:8px 10px;border:1px solid var(--paper3);border-radius:6px;font-family:'Crimson Pro',serif;font-size:14px;background:#fff;margin:6px 0 12px;">
      <button onclick="envoyerInvitation('${projetId}')"
              style="width:100%;padding:8px;background:var(--accent);border:none;border-radius:6px;color:#fff;font-family:'Crimson Pro',serif;font-size:15px;cursor:pointer;">
        Inviter
      </button>
    </div>
  `;

  modal.style.display = 'flex';
}

function fermerCollabModal(){
  document.getElementById('collab-modal').style.display = 'none';
}

async function envoyerInvitation(projetId){
  const email = document.getElementById('collab-email').value.trim();
  if(!email){ flash('Entrez un courriel'); return; }

  // Chercher le user_id correspondant à cet email dans les profils
  const { data: profilData } = await sb.from('profils')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();

  // Fallback : chercher dans auth via une fonction RPC si disponible
  let userId = profilData?.user_id || null;

  const { error } = await sb.from('collaborateurs').insert({
    projet_id: projetId,
    email,
    user_id: userId,
    chapitres_assignes: null,
    invite_par: sbUser.id,
    role: 'editeur',
    accepte: false
  });

  if(error){ flash('Erreur : ' + error.message); return; }
  flash('Invitation enregistrée ✓ — ' + email + ' verra le projet à sa prochaine connexion');
  ouvrirCollabModal(projetId, { stopPropagation: ()=>{} });
}

async function retirerCollab(collabId, projetId){
  if(!confirm('Retirer ce collaborateur ?')) return;
  await sb.from('collaborateurs').delete().eq('id', collabId);
  ouvrirCollabModal(projetId, { stopPropagation: ()=>{} });
  flash('Collaborateur retiré');
}

// Charger les projets partagés avec moi
async function chargerProjetsPartages(){
  if(!sbUser) return [];

  const [{ data: parId, error: e1 }, { data: parEmail, error: e2 }] = await Promise.all([
    sb.from('collaborateurs')
      .select('projet_id, chapitres_assignes, role, projets(id, nom, contenu, mis_a_jour, public)')
      .eq('user_id', sbUser.id),
    sb.from('collaborateurs')
      .select('projet_id, chapitres_assignes, role, projets(id, nom, contenu, mis_a_jour, public)')
      .eq('email', sbUser.email)
  ]);

  if(e1) console.warn('collab par user_id:', e1.message);
  if(e2) console.warn('collab par email:', e2.message);
  console.log('collab parId:', parId?.length, 'parEmail:', parEmail?.length);

  const vus = new Set();
  const tous = [...(parId||[]), ...(parEmail||[])].filter(c => {
    if(!c.projets || vus.has(c.projet_id)) return false;
    vus.add(c.projet_id);
    return true;
  });

  return tous.map(c => ({
    ...c.projets,
    _collab: true,
    _chapitres_assignes: c.chapitres_assignes,
    _role: c.role
  }));
}
