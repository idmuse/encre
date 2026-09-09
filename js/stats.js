// stats.js — Gestion des stats d'écriture
//
// Source de vérité du COMPTE DU JOUR : tracker par chapitre en localStorage.
//   - Au chargement de chaque chapitre (loadChap dans app.js), on enregistre
//     son nombre de mots dans `encre_session_<DATE>_<UID>_<PROJET>`.
//   - Au save, on calcule  mots_du_jour = somme(current.mots - session_start)
//     pour chaque chapitre qui m'appartient.
//   - Robuste face aux désynchronisations entre `projets.contenu.chapitres`
//     (les mots métadonnées) et la table `chapitres` (le vrai contenu).
//
// La table `stats_ecriture` reste alimentée (mots, snapshot_debut, total_mots)
// pour les graphes historiques et la rétrocompatibilité.

(function(){
  const MAX_MOTS_PAR_JOUR = 15000; // garde-fou anti-inflation
  const CLE_SESSION   = (today, uid, pid) => `encre_session_${today}_${uid}_${pid}`;
  const CLE_CLAIM     = (today, uid, pid) => `encre_claims_${today}_${uid}_${pid}`;
  const CLE_CARRYOVER = (today, uid, pid) => `encre_carryover_${today}_${uid}_${pid}`;

  function lireLS(cle){
    try { return JSON.parse(localStorage.getItem(cle) || '{}'); }
    catch(e) { return {}; }
  }
  function ecrireLS(cle, val){
    try { localStorage.setItem(cle, JSON.stringify(val)); } catch(e) {}
  }

  // Détection collab fiable : on préfère P._collab (dérivé des tables
  // collaborateurs/projets.user_id) plutôt que de deviner depuis les auteur_id.
  function detecterCollab(P, chapitres){
    if(P && typeof P._collab === 'boolean') return P._collab;
    const auteurs = new Set(chapitres.map(ch => ch.auteur_id).filter(Boolean));
    return auteurs.size > 1;
  }

  function estMonChapitre(ch, uid, estCollab){
    return estCollab
      ? ch.auteur_id === uid
      : (ch.auteur_id === uid || !ch.auteur_id);
  }

  async function chargerChapitresProjet(sb, projetId){
    const { data: projet } = await sb.from('projets')
      .select('contenu').eq('id', projetId).maybeSingle();
    return projet?.contenu?.chapitres || null;
  }

  window._mettreAJourStatsJour = async function(){
    console.log('%c📊 stats.js appelé', 'color:#c4922a');
    try {
    const sbUser = window.__getsbUser?.();
    const P      = window.__getP?.();
    const sb     = window.__getsb?.();
    if(!sbUser || !P?.projet_cloud_id || !sb){
      console.warn('[stats] Abandon : sbUser/P/sb manquant', {sbUser:!!sbUser, P:!!P, sb:!!sb, cloud:P?.projet_cloud_id});
      return;
    }

    const today    = window.aujourdhui ? window.aujourdhui() : new Date().toISOString().split('T')[0];
    const uid      = sbUser.id;
    const projetId = P.projet_cloud_id;

    const chapitres = await chargerChapitresProjet(sb, projetId);
    if(!chapitres) return;

    const estCollab    = detecterCollab(P, chapitres);
    const mesChapitres = chapitres.filter(ch => estMonChapitre(ch, uid, estCollab));
    if(mesChapitres.length === 0) return;

    const totalMaintenant = mesChapitres.reduce((s, ch) => s + (ch.mots || 0), 0);

    // ─── Calcul primaire : tracker par chapitre (localStorage) ───
    const sessions = lireLS(CLE_SESSION(today, uid, projetId));
    const claims   = lireLS(CLE_CLAIM(today, uid, projetId));

    let motsJour     = 0;
    let snapshotJour = 0;          // = somme des départs (pour stocker en cohérence dans stats_ecriture)
    let aDuTracking  = false;

    mesChapitres.forEach(ch => {
      // Le "départ" d'un chapitre aujourd'hui :
      //   - si claimé aujourd'hui (collab) : mots au moment du claim
      //   - sinon si chargé aujourd'hui     : mots à l'ouverture
      //   - sinon                           : mots actuels (= pas modifié aujourd'hui)
      let depart;
      if(claims[ch.id] !== undefined){
        depart = Number(claims[ch.id]) || 0;
        aDuTracking = true;
      } else if(sessions[ch.id] !== undefined){
        depart = Number(sessions[ch.id]) || 0;
        aDuTracking = true;
      } else {
        depart = ch.mots || 0;
      }
      snapshotJour += depart;
      motsJour     += Math.max(0, (ch.mots || 0) - depart);
    });

    // Carryover : mots écrits AVANT le dernier rechargement de page
    // (stocké en localStorage par app.js à l'init, ou manuellement via console)
    let _carryoverVal = 0;
    if(aDuTracking){
      _carryoverVal = Number(localStorage.getItem(CLE_CARRYOVER(today, uid, projetId))) || 0;
      motsJour += _carryoverVal;
    }

    // ─── Fallback : pas de tracking (premier déploiement, onglet ouvert ───
    // ─── depuis hier, etc.) → on retombe sur l'ancienne logique         ───
    let snapshotDebut = snapshotJour;
    if(!aDuTracking){
      const { data: ligneAujourd } = await sb.from('stats_ecriture')
        .select('snapshot_debut, mots, total_mots')
        .eq('user_id', uid)
        .eq('projet_id', projetId)
        .eq('date', today)
        .maybeSingle();

      if(ligneAujourd && ligneAujourd.snapshot_debut != null){
        snapshotDebut = ligneAujourd.snapshot_debut;
      } else {
        const { data: hier } = await sb.from('stats_ecriture')
          .select('total_mots, date')
          .eq('user_id', uid)
          .eq('projet_id', projetId)
          .lt('date', today)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle();
        // On ne fait confiance à ce total que s'il date d'hier (jour calendaire
        // précédent). S'il y a un trou (plusieurs jours sans sauvegarde cloud —
        // le mode hors ligne le permet maintenant), on ne sait pas répartir le
        // travail entre ces jours : mieux vaut repartir de 0 aujourd'hui que de
        // créditer tout le rattrapage en un seul bloc sur une seule journée.
        const dHier = new Date(today + 'T00:00:00');
        dHier.setDate(dHier.getDate() - 1);
        const hierAttendu = `${dHier.getFullYear()}-${String(dHier.getMonth()+1).padStart(2,'0')}-${String(dHier.getDate()).padStart(2,'0')}`;
        snapshotDebut = (hier && hier.date === hierAttendu) ? hier.total_mots : totalMaintenant;
      }
      if(snapshotDebut > totalMaintenant) snapshotDebut = totalMaintenant;
      motsJour = Math.max(0, totalMaintenant - snapshotDebut);
    }

    // ─── Garde-fou anti-inflation ───
    if(motsJour > MAX_MOTS_PAR_JOUR){
      console.warn(`[stats] Delta du jour suspect (${motsJour} mots). Plafond → re-snapshot.`);
      // Re-snapshot des sessions sur le total actuel : repart proprement
      const nv = {};
      mesChapitres.forEach(ch => { nv[ch.id] = ch.mots || 0; });
      ecrireLS(CLE_SESSION(today, uid, projetId), nv);
      motsJour      = 0;
      snapshotDebut = totalMaintenant;
    }

    await sb.from('stats_ecriture').upsert({
      user_id:        uid,
      projet_id:      projetId,
      date:           today,
      mots:           motsJour,
      snapshot_debut: snapshotDebut,
      total_mots:     totalMaintenant
    }, { onConflict: 'user_id,projet_id,date' });

    // 📊 Log visible dans la console (F12) pour vérifier le calcul
    console.log(
      `%c📊 STATS SAUVEGARDÉES%c\n` +
      `   Carryover (avant reload) : ${_carryoverVal}\n` +
      `   Delta session (depuis reload) : ${motsJour - _carryoverVal}\n` +
      `   ► TOTAL DU JOUR : ${motsJour} mots\n` +
      `   Total chapitres : ${totalMaintenant}  |  Tracking : ${aDuTracking ? 'oui' : 'fallback'}`,
      'background:#2c2416;color:#c4922a;font-weight:bold;padding:2px 6px;border-radius:3px',
      'color:#5a3d0e'
    );

    if(window._motsDejaAujourdhui !== undefined){
      window._motsDejaAujourdhui = motsJour;
    }
    } catch(err) {
      console.error('[stats] ERREUR dans mettreAJourStatsJour :', err);
    }
  };
})();
