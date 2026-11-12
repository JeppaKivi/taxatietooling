/* ==========================================================================================
   Taxatietooling · rekenkern modelmatige factor (MF) + aandachtsscore
   Eén gedeelde kern voor de Controletool wonen, het Parameterlab en Vergelijk portefeuilles.
   De formule staat hier; de parameters (de "leidende set") komen uit het Parameterlab
   (Supabase: mf_vigerend). Wijzig deze kern alleen samen met een nieuwe KERN_VERSIE.
   Bron: Controletool 1.68 (REKENKERN MFv2, gevalideerd tegen werkmap TC_WON 2025 v1.1: 201/201 exact).
   Kern 2 (Controletool 1.83): studenteneenheden krijgen zoals in de werkmap geen MF ("STD") en dus geen score;
   oude LW-labeltabel wordt op waarde herkend (volgorde van de sleutels maakt niet meer uit);
   segmentgrenzen: ongewijzigd (werkmap 148 / 808,04) tot het besluit over de grenzen 2025/2026.
   ========================================================================================== */
(function(g){
  const KERN_VERSIE = '2';
  /* standaardset = vigerend 2025 (zoals in de werkmap); alleen terugval als het platform geen leidende set levert */
  const MF_STD = {
    jaar: '2025', indexatie: 0.025,
    basis: {a1:-16.5, b1:-33, c2:0.6, a3:-12.83, b3:-23.794, lowHLW:0.0188, lowFactor:1.1},
    labels: {NOM:.075, BENG:.075, 'A++++':.075, 'A+++':.075, 'A++':.05, 'A+':.025, A:.0125,
             B:-.05, C:-.1, D:-.15, E:-.175, F:-.175, G:-.175},
    segment: {S:-.0375, V:.0375},
    leegstand: {minWon:10, b1:.1, b2:.2, c1:-.025, c2:-.05},
    woningtype: {EGW:.5, MGW:-.5, Studenteneenheid:-.5, Extramuraal:-.5, Flexwoningen:-.5},
    sted: {ZSS:.5, SS:0, MS:-.5},
    aantr: {H:1, M:.5, L:-.5},
    aangebrokenMGW: -.05,
    labelBouwjaar: {'1920-1940':{A:.10,B:.10,C:.10}, '1940-1960':{A:.05,B:.05,C:.05},
                    '1960-1975':{A:.025,B:.025,C:.025}, '1975-1990':{A:-.05}, '1990-2005':{A:-.025}},
    hlwvDrempel: .055, hlwvOpslag: 1
  };
  const diep = o => JSON.parse(JSON.stringify(o));
  /* leidende set aanvullen met de standaard (velden die in een oudere set ontbreken) */
  function vulAan(cfg){
    const uit = diep(MF_STD); if (!cfg || typeof cfg !== 'object') return uit;
    const meng = (a, b) => { for (const k in b){ if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])){ a[k] = a[k] && typeof a[k] === 'object' ? a[k] : {}; meng(a[k], b[k]); } else a[k] = b[k]; } return a; };
    return meng(uit, cfg);
  }
  function mfBasis(hlw, cfg){
    const b = cfg.basis, idx = 1 + cfg.indexatie;
    if (hlw < b.lowHLW) return (0.5/hlw) * b.lowFactor * idx;
    return ((b.a1*Math.log(hlw)+b.b1 + b.c2/hlw + b.a3*Math.log(hlw)+b.b3) / 3) * idx;
  }
  /* HLW terugrekenen uit de geleverde basis (berekend met de importset; standaard 2025), monotoon -> bisectie */
  function hlwUitBasis(basis, cfg){
    cfg = cfg || MF_STD; let lo = 1e-4, hi = 0.3;
    for (let i = 0; i < 80; i++){ const m = (lo+hi)/2; if (mfBasis(m, cfg) > basis) lo = m; else hi = m; }
    return (lo+hi)/2;
  }
  function bjKlasse(bj){
    if (bj == null) return null;
    if (bj < 1920) return 'tot1920';
    if (bj < 1940) return '1920-1940';
    if (bj < 1960) return '1940-1960';
    if (bj < 1975) return '1960-1975';
    if (bj < 1990) return '1975-1990';
    if (bj < 2005) return '1990-2005';
    return '2005+';
  }
  const _STED = {'0.5':'ZSS','0':'SS','-0.5':'MS'};
  const _AANTR = {'1':'H','0.5':'M','-0.5':'L'};
  /* invoer van de formule per complex. Sinds Controletool 1.69 staat die bij import letterlijk in het pakket (c.inp);
     voor oudere pakketten afgeleid uit de bij import vastgelegde opbouw (rk) — eenmalig, daarna vast (c._inp) */
  function complexInput(c){
    if (c._inp) return c._inp;
    if (c.inp && typeof c.inp === 'object'){ c._inp = Object.assign({}, c.inp); return c._inp; }
    const rk = c.rk || {};
    c._inp = {
      hlw: c.hlw != null ? c.hlw : (c.basis != null ? hlwUitBasis(c.basis) : null),
      huurpotentie: rk.huurpotentie || 0,
      sted: _STED[String(rk.stedelijkheid)] || 'SS',
      aantr: _AANTR[String(rk.aantrekkelijkheid)] || 'M',
      type: c.typeInv || c.type, lab: (c.lab || '').trim(), bj: c.bj,   /* woningtype uit het invulformat (Onzst. is alleen weergave) */
      sector: (rk.impactSegment || 0) > 0 ? 'V' : ((rk.impactSegment || 0) < 0 ? 'S' : 'S'),
      leeg: c.leeg || 0, vhe: c.vhe || 0,
      aangebroken: (rk.aangebroken || 0) !== 0,
      fallbackLab: rk.impactLabel != null ? rk.impactLabel : 0
    };
    return c._inp;
  }
  /* werkmap (configTypeWoning): woningtype Studenteneenheid -> MF "STD", geen toetsing */
  const isStd = x => !!x && String(x.typeInv || x.type || '').trim().toLowerCase() === 'studenteneenheid';
  function mfBereken(inp, cfg){
    if (inp.hlw == null || isStd(inp)) return null;
    const basis = mfBasis(inp.hlw, cfg);
    let fLab = cfg.labels[inp.lab];
    if (fLab == null) fLab = inp.fallbackLab || 0;   /* BENG/NOM zonder labelstring */
    const fSeg = cfg.segment[inp.sector] || 0;
    const L = cfg.leegstand;
    const fLeeg = inp.vhe > L.minWon ? (inp.leeg > L.b2 ? L.c2 : (inp.leeg > L.b1 ? L.c1 : 0)) : 0;
    const fAang = (inp.type === 'MGW' && inp.aangebroken) ? cfg.aangebrokenMGW : 0;
    const grp = (inp.lab === 'A' || inp.lab === 'B' || inp.lab === 'C') ? inp.lab : null;
    const fLB = grp ? ((cfg.labelBouwjaar[bjKlasse(inp.bj)] || {})[grp] || 0) : 0;
    const fSted = cfg.sted[inp.sted] ?? 0, fAantr = cfg.aantr[inp.aantr] ?? 0;
    const fType = cfg.woningtype[inp.type] ?? 0;
    const som = basis + inp.huurpotentie + fSted + fAantr + fType;
    const hlwv = inp.hlw > cfg.hlwvDrempel ? cfg.hlwvOpslag : 0;
    return {mf: som*(1+fLab)*(1+fSeg)*(1+fLeeg)*(1+fAang)*(1+fLB) + hlwv,
            basis, som, fLab, fSeg, fLeeg, fAang, fLB, fSted, fAantr, fType, hlwv,
            huurpotentie: inp.huurpotentie, hlw: inp.hlw};
  }
  /* complex (pakketrij) herrekenen met de leidende set: MF, KF-band, afwijking, opbouw. De invoer blijft die van de import. */
  function herreken(c, cfg){
    let inp; try{ inp = complexInput(c); }catch(e){ return false; }
    if (inp && (isStd(inp) || isStd(c))){ c.mf = null; c.basis = null; c.kfmin = null; c.kfmax = null; c.afw = 0; c.std = true; return true; }
    if (!inp || inp.hlw == null) return false;
    const R = mfBereken(inp, cfg); if (!R || !isFinite(R.mf) || !(R.mf > 0)) return false;
    c.mf = R.mf; c.basis = R.basis;
    c.kfmin = R.mf * .925; c.kfmax = R.mf * 1.075;
    c.afw = c.kf ? c.kf / R.mf - 1 : 0;
    c.rk = Object.assign({}, c.rk || {}, {corrLabelBouwjaar: R.fLB, impactLabel: R.fLab, impactHLW: R.hlwv, impactSegment: R.fSeg,
      huurpotentie: inp.huurpotentie, leegstandc: R.fLeeg, stedelijkheid: R.fSted, aantrekkelijkheid: R.fAantr, woningtype: R.fType, aangebroken: R.fAang});
    return true;
  }
  /* ---------- toetsconfiguratie (Config-tab van de Controletool, per klant gedeeld) ---------- */
  const TCFG_DEF = {
    afwOk: 5, afwGeel: 10, afwWarn: 15,
    mfOk: 10, mfWarn: 15,
    kfBand: 7.5,
    segWws: 148, segHuur: 808.04,
    aandacht: 10,
    ekMin: 30, ekMax: 55,
    lw: {'A++': [null, null], 'A+': [null, null], 'A': [null, null], 'B': [null, null], 'C': [null, null], 'DG': [null, null]},
  };
  /* configs van 1.38-1.43 bevatten de oude voorlopige LW-labeltabel als 'waarde': die telt niet als bewuste overschrijving */
  const OUD_LW = {'A++': [62.5, 77.5], 'A+': [60, 77.5], 'A': [57.5, 75], 'B': [55, 72.5], 'C': [52.5, 70], 'DG': [50, 67.5]};
  function isOudLW(lw){
    if (!lw || typeof lw !== 'object') return false;
    const k1 = Object.keys(lw).sort(), k2 = Object.keys(OUD_LW).sort();
    return k1.join('|') === k2.join('|') && k2.every(k => Array.isArray(lw[k]) && lw[k][0] === OUD_LW[k][0] && lw[k][1] === OUD_LW[k][1]);
  }
  function tcfgVan(opgeslagen){
    const T = diep(TCFG_DEF);
    try{
      const _tc = opgeslagen;
      if (_tc){ for (const k in TCFG_DEF) if (_tc[k] != null) T[k] = _tc[k]; }
      if (isOudLW(T.lw)) T.lw = diep(TCFG_DEF.lw);
      if (T.segWws === 144 && T.segHuur === 900.07){ T.segWws = TCFG_DEF.segWws; T.segHuur = TCFG_DEF.segHuur; }   /* oude standaard 1.42-1.43; vervalt bij het besluit over de segmentgrenzen */
    }catch(e){}
    return T;
  }
  function lwBandCfg(lab, rMin, rMax, T){
    const l = !lab ? null : (String(lab).startsWith('A++') ? 'A++' : (T.lw[lab] ? lab : (String(lab).startsWith('A') ? 'A+' : 'DG')));
    const b = l && T.lw[l];
    if (b && b[0] != null && b[1] != null) return [b[0] / 100, b[1] / 100];
    return [rMin, rMax];
  }
  /* marktwaarde incl. kapitaalscorrecties (keuze per browser in de Controletool; standaard excl.) */
  function rBasis(r, incl){
    if (!incl || !r || r.mwCorr == null || Math.abs(r.mwCorr) < 1 || !(r.mw_vhe > 0) || !(r.vhe > 0)) return r;
    const mwEx = r.mw_vhe * r.vhe, f = (mwEx + r.mwCorr) / mwEx;
    if (!(f > 0)) return r;
    const o = Object.assign({}, r, {mw_vhe: r.mw_vhe * f, mwm2: r.mwm2 != null ? r.mwm2 * f : r.mwm2, kf: r.kf != null ? r.kf * f : r.kf,
      lwr: r.lwr != null ? r.lwr * f : r.lwr, bar: r.bar ? r.bar / f : r.bar, nar: r.nar ? r.nar / f : r.nar, _mwF: f});
    if (r.o2 && typeof r.o2 === 'object') o.o2 = Object.assign({}, r.o2, {kfthi: r.o2.kfthi != null ? r.o2.kfthi * f : r.o2.kfthi, kfmh: r.o2.kfmh != null ? r.o2.kfmh * f : r.o2.kfmh});
    return o;
  }
  /* ---------- aandachtsscore: 1-op-1 TotaalScore/RangScore uit de controletool-werkmap ---------- */
  const KFMH_BAND = {ZSS:{H:{A:[14,22],'B/C':[13,21],'D-G':[11,19]},M:{A:[13,21],'B/C':[12,20],'D-G':[10,18]},L:{A:[12,20],'B/C':[11,19],'D-G':[9,17]}},
    SS:{H:{A:[13.5,21],'B/C':[12.5,20],'D-G':[10.5,18]},M:{A:[12.5,20],'B/C':[11.5,19],'D-G':[9,17]},L:{A:[11.5,19],'B/C':[10.5,18],'D-G':[8,15]}},
    MS:{H:{A:[13,20],'B/C':[12,19],'D-G':[10,17]},M:{A:[12,19],'B/C':[11,18],'D-G':[8.5,16]},L:{A:[11,18],'B/C':[10,17],'D-G':[7,14]}}};
  const LABGRP_SCORE = l => { l = String(l || '').trim(); if (!l) return null;
    if (l === 'B' || l === 'C') return 'B/C'; if (['D','E','F','G'].includes(l)) return 'D-G'; return 'A'; };
  function aandachtScore(r, n, T){
    T = T || TCFG_DEF;
    if (!(r.mf > 1)) return null;
    let du = 0, dv = 0; const det = [];
    const kf = n.kfthi;
    if (kf > 0){
      const ae = r.mf * (1 - T.kfBand / 100), af = r.mf * (1 + T.kfBand / 100);
      const binnenSmal = kf >= ae && kf <= af;
      const binnenBreed = kf >= ae * 0.975 && kf <= af * 1.025;
      if (!binnenBreed){ du += 20; dv += 20; det.push(['KF THI ver buiten band (MF ±7,5% +2,5%)', 20]); }
      else if (!binnenSmal){ du += 10; det.push(['KF THI buiten band (MF ±7,5%)', 10]); }
    }
    const _lwA = lwBandCfg(r.lab, r.lwmin, r.lwmax, T);
    if (r.lwr != null && _lwA[0] != null){
      const binnenSmal = r.lwr >= _lwA[0] && r.lwr <= _lwA[1];
      const binnenBreed = r.lwr >= _lwA[0] - 0.025 && r.lwr <= _lwA[1] + 0.025;
      if (!binnenBreed){ du += 10; dv += 10; det.push(['LWR ver buiten band (+2,5%-punt)', 10]); }
      else if (!binnenSmal){ du += 5; det.push(['LWR buiten band', 5]); }
    }
    /* stedelijkheid/aantrekkelijkheid als categorie uit de invoer (niet uit de factor: die verandert mee met de set) */
    const inp = r._inp || r.inp || null, rk = r.rk || {};
    const sted = inp && inp.sted ? inp.sted : (rk.stedelijkheid === .5 ? 'ZSS' : rk.stedelijkheid === -.5 ? 'MS' : 'SS');
    const aantr = inp && inp.aantr ? inp.aantr : (rk.aantrekkelijkheid === 1 ? 'H' : rk.aantrekkelijkheid === -.5 ? 'L' : 'M');
    const lg = LABGRP_SCORE(r.lab);
    const band = lg && KFMH_BAND[sted] && KFMH_BAND[sted][aantr] ? KFMH_BAND[sted][aantr][lg] : null;
    if (n.kfmh > 0 && band && !(n.kfmh >= band[0] && n.kfmh <= band[1])){
      du += 2; det.push(['KF markthuur buiten ' + band[0].toLocaleString('nl-NL') + ' – ' + band[1].toLocaleString('nl-NL') + ' (' + sted + '/' + aantr + '/' + lg + ')', 2]);
    }
    return {du, dv, det};
  }
  /* aandachtscomplex zoals de Controletool het telt (telAand): RangScore ≥ drempel uit de toetsconfiguratie */
  function isAandacht(r0, T, incl){
    const r = rBasis(r0, incl); if (!(r.mf > 1)) return null;
    const sc = aandachtScore(r, r.o2 || {}, T); return sc ? {aan: sc.dv >= (T || TCFG_DEF).aandacht, sc} : null;
  }
  g.TTKERN = {KERN_VERSIE, MF_STD, vulAan, mfBasis, hlwUitBasis, bjKlasse, complexInput, mfBereken, herreken,
    TCFG_DEF, tcfgVan, isOudLW, isStd, lwBandCfg, rBasis, KFMH_BAND, LABGRP_SCORE, aandachtScore, isAandacht};
})(typeof window !== 'undefined' ? window : globalThis);
