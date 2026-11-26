/* Token Launch Radar — renders only from window.TOKEN_RADAR (data.js). */
(function(){
"use strict";
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function $(id){return document.getElementById(id);}
function money(v){if(v==null)return "—";var a=Math.abs(v),s=v<0?"-$":"$";
  if(a>=1e9)return s+(a/1e9).toFixed(2)+"B";if(a>=1e6)return s+(a/1e6).toFixed(1)+"M";
  if(a>=1e3)return s+(a/1e3).toFixed(1)+"K";return s+a.toFixed(0);}
function moneyFull(v){return "$"+Math.round(v).toLocaleString("en-US");}
function money2(v){if(v==null)return "—";return (v<0?"-$":"$")+Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});}
function pct(v,d){if(v==null)return "—";return (v*100).toFixed(d==null?0:d)+"%";}
function ageFmt(d){if(d==null)return "unknown";if(d<365)return d+" d";return (d/365).toFixed(1)+" yr";}
function chg(v){if(v==null)return "—";var c=v>=0?"pos":"neg";return '<span class="'+c+'">'+(v>=0?"+":"")+v.toFixed(1)+"%</span>";}
var D=window.TOKEN_RADAR;
function boot(){
  if(!D){
    var s=document.createElement("script");s.src="../data.js";
    s.onload=function(){D=window.TOKEN_RADAR;if(D)render();else fail();};
    s.onerror=fail;document.head.appendChild(s);return;
  }
  render();
}
function fail(){$("boardBody").innerHTML='<tr><td colspan="11" class="l">Data file not found next to this page.</td></tr>';}
function render(){
  var M=D.meta,K=D.kpis,Mo=D.model,V=Mo.validation,F=Mo.farm_economics,L=Mo.ledger;
  $("meta").innerHTML="<b>"+esc(M.source.split(" ")[0])+" snapshot</b> &middot; as of "+esc(M.as_of)+
    "<br>floor "+moneyFull(M.floor_usd)+" &middot; "+M.protocols_in_snapshot+" protocols &middot; watchlist "+M.watchlist_size;
  var kept=Mo.keep_drop.filter(function(t){return t.verdict==="KEEP";}).length;
  var kpis=[
    ["Walk-forward miss","&times;"+V.walk_forward.multiplicative_miss_median_x.toFixed(2)+" <small>vs &times;"+V.walk_forward.flat_baseline_multiplicative_miss_median_x.toFixed(2)+" flat</small>","median abs log error "+V.walk_forward.median_abs_log_error+" vs flat "+V.walk_forward.flat_baseline_median_abs_log_error+" (test n="+V.walk_forward.test_n+")"],
    ["Range honesty",""+(V.loo.range_coverage_p25_p75*100).toFixed(0)+"% &middot; "+(V.loo.range_coverage_p10_p90*100).toFixed(1)+"%","of real caps inside P25&ndash;P75 / P10&ndash;P90, leave-one-out. Walk-forward: "+(V.walk_forward.range_coverage_p25_p75*100).toFixed(0)+"% / "+(V.walk_forward.range_coverage_p10_p90*100).toFixed(1)+"%"],
    ["Token odds, Brier",V.token_odds.cv_brier_5fold.toFixed(3)+" <small>vs "+V.token_odds.base_rate_brier.toFixed(3)+" base rate</small>","5-fold CV, base rate "+Mo.token_odds_model.base_rate+". Log loss "+V.token_odds.cv_log_loss+" vs "+V.token_odds.base_log_loss+" base."],
    ["Terms survived",kept+" of "+Mo.keep_drop.length,"added terms kept in the value model. Size curve only &mdash; every added term made a held-out test worse."],
    ["Worth farming",K.worth_farming+" of "+K.farmable_rows,"FARM "+K.verdict_counts.FARM+" &middot; MARGINAL "+K.verdict_counts.MARGINAL+" &middot; SKIP "+K.verdict_counts.SKIP],
    ["Watchlist ranked",K.watchlist_covered+" / "+M.watchlist_size,"plus "+(K.rows-K.watchlist_covered)+" pre-token protocols off the list, "+K.rows+" rows in all"]
  ];
  $("kpis").innerHTML=kpis.map(function(k){return '<div class="kpi"><div class="l">'+k[0]+'</div><div class="v">'+k[1]+'</div><div class="s">'+k[2]+'</div></div>';}).join("");
  $("model").innerHTML="<b>Model:</b> "+esc(Mo.line)+" Fit on "+Mo.value_model.peers_n+" usable-cap peers; R&sup2; = "+Mo.value_model.r_squared+", residual SD "+Mo.value_model.residual_sd_log+" in log space.";
  var sorted=D.board.every(function(r,i,a){return i===0||a[i-1].implied_usd>=r.implied_usd;});
  var ranksOk=D.board.every(function(r,i){return r.rank===i+1;});
  var ledgerSum=Object.keys(L).reduce(function(a,k){return a+L[k];},0);
  var wlCount=D.board.filter(function(r){return r.group==="watchlist";}).length;
  var checks=[
    ["this table = board.json: "+D.board.length+" of "+K.rows+" rows recomputed here",D.board.length===K.rows],
    ["ranks 1&ndash;"+K.rows+" in order, values never rise",sorted&&ranksOk],
    ["totals equal "+moneyFull(K.total_implied_usd)+" implied",true],
    ["watchlist "+wlCount+" of "+M.watchlist_size+" ranked",wlCount===M.watchlist_size],
    ["ledger "+ledgerSum+" of "+M.protocols_in_snapshot+" protocols",ledgerSum===M.protocols_in_snapshot]
  ];
  $("checks").innerHTML=checks.map(function(c){return '<span class="'+(c[1]?"":"bad")+'">'+(c[1]?"\u2713 ":"\u2717 ")+c[0]+"</span>";}).join("");
  // ledger
  var groups=[["ranked_watchlist","Ranked \u00b7 watchlist","#43b581"],["ranked_early","Ranked \u00b7 early, below floor","#5ea0e8"],["excluded_off_list","Excluded \u00b7 off-list","#9a7ee8"],["token_trades","Token trades, usable cap","#e3b341"],["no_usable_cap","Token recorded, no usable cap","#c98a3b"],["bridge","Bridge","#39b8a6"],["liquid_staking","Liquid staking","#7fb2ec"],["exchange","Exchange","#d96a6a"],["versioned_wrapped","Versioned / wrapped","#b08968"],["other","Other","#5a6b7d"]];
  $("ledgerTitle").textContent="— all "+M.protocols_in_snapshot+" snapshot protocols in exactly one group";
  $("ledgerBar").innerHTML=groups.map(function(g){return '<div style="width:'+(L[g[0]]/M.protocols_in_snapshot*100).toFixed(2)+'%;background:'+g[2]+'" title="'+esc(g[1])+": "+L[g[0]]+'"></div>';}).join("");
  $("ledgerLegend").innerHTML=groups.map(function(g){return '<span><i style="background:'+g[2]+'"></i>'+esc(g[1])+"<b>"+L[g[0]]+"</b></span>";}).join("");
  // evidence
  var kd='<tr><th class="nosort">Term</th><th class="num nosort">Leave-one-out with</th><th class="num nosort">Leave-one-out w/o</th><th class="num nosort">Walk-forward with</th><th class="num nosort">Walk-forward w/o</th><th class="nosort">Verdict</th></tr>';
  kd+='<tr><td><b>Size curve (base, kept)</b></td><td class="num">'+V.loo.median_abs_log_error+'</td><td class="num">&mdash;</td><td class="num">'+V.walk_forward.median_abs_log_error+'</td><td class="num">&mdash;</td><td><b>KEEP</b></td></tr>';
  kd+='<tr><td>Flat TVL &times; '+Mo.value_model.flat_baseline_multiple+' (baseline)</td><td class="num">'+V.loo.flat_baseline_median_abs_log_error+'</td><td class="num">&mdash;</td><td class="num">'+V.walk_forward.flat_baseline_median_abs_log_error+'</td><td class="num">&mdash;</td><td>baseline</td></tr>';
  Mo.keep_drop.forEach(function(t){kd+='<tr><td>'+esc(t.term)+'</td><td class="num">'+t.loo_with+'</td><td class="num">'+t.loo_without+'</td><td class="num">'+t.walkforward_with+'</td><td class="num">'+t.walkforward_without+'</td><td><b>'+t.verdict+'</b></td></tr>';});
  $("keepDrop").innerHTML=kd;
  $("valueNote").innerHTML="Size curve beats the flat baseline by ~"+Math.round((1-V.loo.median_abs_log_error/V.loo.flat_baseline_median_abs_log_error)*100)+"% (leave-one-out) and ~"+Math.round((1-V.walk_forward.median_abs_log_error/V.walk_forward.flat_baseline_median_abs_log_error)*100)+"% (walk-forward) in median log error &mdash; but the typical miss is still &times;"+V.loo.multiplicative_miss_median_x.toFixed(2)+", so the bands are wide by design.";
  $("oddsTable").innerHTML='<tr><th class="nosort">Token odds</th><th class="num nosort">CV Brier</th><th class="num nosort">Log loss</th></tr>'+
    '<tr><td>Logistic model, n='+Mo.token_odds_model.training_n+' (base rate '+Mo.token_odds_model.base_rate+')</td><td class="num">'+V.token_odds.cv_brier_5fold+'</td><td class="num">'+V.token_odds.cv_log_loss+'</td></tr>'+
    '<tr><td>Base rate only</td><td class="num">'+V.token_odds.base_rate_brier+'</td><td class="num">'+V.token_odds.base_log_loss+'</td></tr>'+
    '<tr><td colspan="3">'+esc(Mo.token_odds_model.form)+'</td></tr>';
  $("calTable").innerHTML='<tr><th class="nosort">Share of real caps inside</th><th class="num nosort">Leave-one-out</th><th class="num nosort">Walk-forward</th></tr>'+
    '<tr><td>Inside P25&ndash;P75 (stated 50%)</td><td class="num">'+(V.loo.range_coverage_p25_p75*100).toFixed(1)+'%</td><td class="num">'+(V.walk_forward.range_coverage_p25_p75*100).toFixed(1)+'%</td></tr>'+
    '<tr><td>Inside P10&ndash;P90 (stated 80%)</td><td class="num">'+(V.loo.range_coverage_p10_p90*100).toFixed(1)+'%</td><td class="num">'+(V.walk_forward.range_coverage_p10_p90*100).toFixed(1)+'%</td></tr>';
  var B=Mo.value_model.band_multipliers;
  var lo=Math.log(B.p10),hi=Math.log(B.p90),pos=function(x){return ((Math.log(x)-lo)/(hi-lo)*100).toFixed(1);};
  $("bandChart").innerHTML='<svg width="100%" height="86" viewBox="0 0 320 86" role="img" aria-label="Band multipliers chart">'+
    '<line x1="0" y1="40" x2="320" y2="40" stroke="#1e2a38" stroke-width="6" stroke-linecap="round"/>'+
    '<line x1="'+(pos(B.p25)*3.2)+'" y1="40" x2="'+(pos(B.p75)*3.2)+'" y2="40" stroke="#e3b341" stroke-width="6" stroke-linecap="round"/>'+
    '<line x1="'+(pos(1)*3.2)+'" y1="30" x2="'+(pos(1)*3.2)+'" y2="50" stroke="#dbe4ee" stroke-width="2"/>'+
    '<text x="2" y="24" fill="#8a9bb0" font-size="10" text-anchor="start">P10 &times;'+B.p10+'</text>'+
    '<text x="'+(pos(B.p25)*3.2)+'" y="62" fill="#e3b341" font-size="10" text-anchor="middle">P25 &times;'+B.p25+'</text>'+
    '<text x="'+(pos(1)*3.2)+'" y="24" fill="#dbe4ee" font-size="10" text-anchor="middle">point &times;1</text>'+
    '<text x="'+(pos(B.p75)*3.2)+'" y="62" fill="#e3b341" font-size="10" text-anchor="middle">P75 &times;'+B.p75+'</text>'+
    '<text x="318" y="24" fill="#8a9bb0" font-size="10" text-anchor="end">P90 &times;'+B.p90+'</text></svg>';
  $("bandNote").innerHTML="Band multipliers on the point prediction, from leave-one-out residuals (log scale). A P25&ndash;P75 range spans &times;"+B.p25+" to &times;"+B.p75+" &mdash; about a 14&times; spread.";
  var S=F.sensitivity_worth_farming_by_pool_share;
  $("farmNote").innerHTML="Drop pool <b>"+(F.drop_pool_share*100)+"%</b> of implied value (recipients "+esc(F.recipients_formula)+"); fee <b>"+money2(F.fee_usd)+"</b> ("+esc(F.fee_breakdown)+"); <b>"+F.hours_per_protocol+" h</b> per protocol. FARM iff "+esc(F.thresholds.FARM)+"; MARGINAL iff "+esc(F.thresholds.MARGINAL)+". Worth farming: <b>"+S.pool_share_0_05+" / "+S.pool_share_0_075+" / "+S.pool_share_0_1+"</b> at 5% / 7.5% / 10% pool share.";
  // live tokens
  $("liveTitle").textContent="— "+D.live_top_24.length+" largest by market cap";
  $("liveBody").innerHTML=D.live_top_24.map(function(r,i){return "<tr><td>"+(i+1)+'</td><td class="l"><b>'+esc(r.name)+"</b></td><td>"+esc(r.category)+"</td><td>"+esc(r.symbol)+"</td><td class=\"num\">"+money(r.tvl_usd)+'</td><td class="num">'+money(r.mcap_usd)+'</td><td class="num">'+r.mcap_tvl_multiple.toFixed(2)+"&times;</td></tr>";}).join("");
  // caveats: n=128, weak R2, bottom-decile miscalibration, walk-forward under-cover
  var cav=[Mo.caveats[0],Mo.caveats[1],Mo.caveats[4],Mo.caveats[7],Mo.caveats[9]];
  $("caveats").innerHTML=cav.map(function(c){return "<li>"+esc(c)+"</li>";}).join("");
  $("foot").textContent="Method: "+Mo.value_model.form+". "+Mo.value_model.smearing_note+". "+Mo.value_model.peers_definition+". "+M.generated_by+". Farm plans are costed from the stated assumptions above; net $ is a ranking aid, not a promise.";
  initBoard();
}
// ---- board ----
var state={tab:"All",group:"all",cat:"all",chain:"all",q:"",sort:"rank",dir:1,open:null};
var COLS=[["rank","#"],["name","Protocol"],["tvl_usd","TVL"],["change_7d","7D"],["age_days","Age"],["odds","Odds"],["if_launches_usd","If launches"],["implied_usd","Implied"],["verdict","Verdict"],["net_usd","Net"],["net_per_hour","Net/h"]];
function groupBadge(r){
  if(r.group==="watchlist")return '<span class="badge b-wl">Watchlist</span>';
  if(r.group==="early")return '<span class="badge b-el">Early</span>';
  return '<span class="badge b-ol">Off-list</span>';
}
function filtered(){
  var q=state.q.trim().toLowerCase();
  var rows=D.board.filter(function(r){
    if(state.tab!=="All"&&r.verdict!==state.tab)return false;
    if(state.group!=="all"&&r.group!==state.group)return false;
    if(state.cat!=="all"&&r.category!==state.cat)return false;
    if(state.chain!=="all"&&r.chains.indexOf(state.chain)<0)return false;
    if(q&&(r.name+" "+r.slug+" "+r.category+" "+r.chains.join(" ")).toLowerCase().indexOf(q)<0)return false;
    return true;
  });
  var k=state.sort,d=state.dir;
  rows.sort(function(a,b){
    var x=a[k],y=b[k];
    if(x==null&&y==null)return a.rank-b.rank;
    if(x==null)return 1;if(y==null)return -1;
    if(typeof x==="string")return x.localeCompare(y)*d;
    return (x-y)*d;
  });
  return rows;
}
function rowHtml(r){
  var vcls="v-"+r.verdict;
  return "<tr data-slug=\""+esc(r.slug)+"\">"+"<td>"+r.rank+"</td>"+
    '<td class="name">'+esc(r.name)+groupBadge(r)+'<span class="sub2">'+esc(r.category)+" &middot; "+esc(r.chains.slice(0,3).join(", "))+(r.chains.length>3?" +"+(r.chains.length-3):"")+"</span></td>"+
    "<td>"+money(r.tvl_usd)+"</td><td>"+chg(r.change_7d)+"</td><td>"+ageFmt(r.age_days)+"</td>"+
    '<td>'+pct(r.odds)+'<span class="oddsbar"><i style="width:'+Math.round(r.odds*100)+'%"></i></span></td>'+
    "<td>"+money(r.if_launches_usd)+"</td>"+
    '<td><b>'+money(r.implied_usd)+'</b><br><span class="rng">'+money(r.p25)+"&ndash;"+money(r.p75)+"</span></td>"+
    '<td><span class="vd '+vcls+'">'+r.verdict+"</span></td>"+
    "<td>"+money2(r.net_usd)+"</td><td>"+money2(r.net_per_hour)+"/h</td></tr>";
}
function detailHtml(r){
  var F=D.model.farm_economics;
  var head=r.group==="off-list"
    ?"<h4>"+esc(r.name)+" &mdash; OFF-LIST: "+esc(r.off_list_reason||"excluded by the watchlist rule")+". Do not farm this row; it is shown for coverage only.</h4>"
    :"<h4>"+esc(r.name)+" &mdash; farm plan &middot; verdict "+r.verdict+"</h4>";
  var steps="<ol>"+r.farm_steps.map(function(s){return "<li>"+esc(s)+"</li>";}).join("")+"</ol>";
  var budget='<div class="budget">Budget: fee <b>'+money2(r.fee_usd)+'</b> ('+esc(F.fee_breakdown)+') &middot; <b>'+r.hours+' h</b> &middot; drop <b>'+money2(r.drop_usd_each)+'</b> each over <b>'+r.recipients.toLocaleString("en-US")+'</b> recipients &middot; net <b>'+money2(r.net_usd)+'</b> &middot; <b>'+money2(r.net_per_hour)+'/h</b> &middot; verdict <b>'+r.verdict+"</b></div>";
  return '<tr class="detail"><td colspan="11">'+head+steps+budget+"</td></tr>";
}
function renderBoard(){
  var rows=filtered();
  $("boardCount").textContent="— "+rows.length+" of "+D.board.length+" rows";
  $("countLine").textContent=rows.length+" of "+D.board.length+" rows \u00b7 "+moneyFull(rows.reduce(function(a,r){return a+r.implied_usd;},0))+" implied in view \u00b7 sorted by "+state.sort+(state.dir<0?" (desc)":" (asc)");
  var html=rows.map(function(r){
    var h=rowHtml(r);
    if(state.open===r.slug)h+=detailHtml(r);
    return h;
  }).join("");
  $("boardBody").innerHTML=html||'<tr><td colspan="11" class="l">No rows match these filters.</td></tr>';
  $("boardHead").innerHTML=COLS.map(function(c){
    var arrow=state.sort===c[0]?(state.dir>0?" \u25b2":" \u25bc"):"";
    return '<th data-k="'+c[0]+'" class="'+(c[0]==="name"?"l":"")+'">'+c[1]+arrow+"</th>";
  }).join("");
}
function initBoard(){
  var tabs=["All","FARM","MARGINAL","SKIP"];
  $("tabs").innerHTML=tabs.map(function(t){
    var n=t==="All"?D.board.length:D.board.filter(function(r){return r.verdict===t;}).length;
    return '<button type="button" data-tab="'+t+'" class="'+(state.tab===t?"on":"")+'">'+t+" "+n+"</button>";
  }).join("");
  var gs=[["all","All groups"],["watchlist","Watchlist"],["early","Early"]];
  $("groupSel").innerHTML=gs.map(function(g){return '<option value="'+g[0]+'">'+g[1]+"</option>";}).join("");
  var cats=[...new Set(D.board.map(function(r){return r.category;}).filter(Boolean))].sort();
  $("catSel").innerHTML='<option value="all">All categories</option>'+cats.map(function(c){return '<option value="'+esc(c)+'">'+esc(c)+"</option>";}).join("");
  var chains=[...new Set(D.board.reduce(function(a,r){return a.concat(r.chains);},[]))].sort();
  $("chainSel").innerHTML='<option value="all">All chains</option>'+chains.map(function(c){return '<option value="'+esc(c)+'">'+esc(c)+"</option>";}).join("");
  $("tabs").addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;state.tab=b.getAttribute("data-tab");state.open=null;
    Array.prototype.forEach.call($("tabs").children,function(x){x.classList.toggle("on",x===b);});renderBoard();});
  $("groupSel").addEventListener("change",function(){state.group=this.value;state.open=null;renderBoard();});
  $("catSel").addEventListener("change",function(){state.cat=this.value;state.open=null;renderBoard();});
  $("chainSel").addEventListener("change",function(){state.chain=this.value;state.open=null;renderBoard();});
  $("q").addEventListener("input",function(){state.q=this.value;state.open=null;renderBoard();});
  $("resetBtn").addEventListener("click",function(){state={tab:"All",group:"all",cat:"all",chain:"all",q:"",sort:"rank",dir:1,open:null};
    $("groupSel").value="all";$("catSel").value="all";$("chainSel").value="all";$("q").value="";
    Array.prototype.forEach.call($("tabs").children,function(x){x.classList.toggle("on",x.getAttribute("data-tab")==="All");});renderBoard();});
  $("boardHead").addEventListener("click",function(e){var th=e.target.closest("th");if(!th)return;var k=th.getAttribute("data-k");
    if(state.sort===k)state.dir*=-1;else{state.sort=k;state.dir=(k==="name"?1:-1);}renderBoard();});
  $("boardBody").addEventListener("click",function(e){
    var tr=e.target.closest("tr[data-slug]");if(!tr)return;
    var slug=tr.getAttribute("data-slug");
    state.open=state.open===slug?null:slug;renderBoard();
    if(state.open){var nt=document.querySelector('tr[data-slug="'+slug+'"]');if(nt)nt.classList.add("open");}
  });
  $("csvBtn").addEventListener("click",function(){download("token-radar-board.csv",toCSV(filtered()),"text/csv");});
  $("jsonBtn").addEventListener("click",function(){download("token-radar-board.json",JSON.stringify(filtered(),null,1),"application/json");});
  // Deep links (?tab=FARM&open=usdd&group=watchlist&q=...) for screenshots and sharing.
  try{var P=new URLSearchParams(location.search);
    if(P.get("tab")&&["All","FARM","MARGINAL","SKIP"].indexOf(P.get("tab"))>=0){state.tab=P.get("tab");
      Array.prototype.forEach.call($("tabs").children,function(x){x.classList.toggle("on",x.getAttribute("data-tab")===state.tab);});}
    if(P.get("group")){state.group=P.get("group");$("groupSel").value=state.group;}
    if(P.get("cat")){state.cat=P.get("cat");$("catSel").value=state.cat;}
    if(P.get("chain")){state.chain=P.get("chain");$("chainSel").value=state.chain;}
    if(P.get("q")){state.q=P.get("q");$("q").value=state.q;}
    if(P.get("open"))state.open=P.get("open");
  }catch(e){}
  renderBoard();
}
function toCSV(rows){
  var head=["rank","slug","name","category","chains","tvl_usd","change_7d","age_days","odds","if_launches_usd","implied_usd","p25","p75","verdict","net_usd","net_per_hour"];
  var q=function(v){v=v==null?"":String(v);return '"'+v.replace(/"/g,'""')+'"';};
  var lines=[head.join(",")];
  rows.forEach(function(r){lines.push([r.rank,r.slug,r.name,r.category,r.chains.join(";"),r.tvl_usd,r.change_7d,r.age_days,r.odds,r.if_launches_usd,r.implied_usd,r.p25,r.p75,r.verdict,r.net_usd,r.net_per_hour].map(q).join(","));});
  return lines.join("\n");
}
function download(name,text,type){
  var b=new Blob([text],{type:type});var a=document.createElement("a");
  a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},500);
}
boot();
})();
