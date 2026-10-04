"use strict";

/*
 * "Take a break": Super Over, a small cricket batting game, for the moments when
 * RTS is slow. It runs entirely inside the extension: no network, nothing is
 * read from or written to RTS. It lives in its own shadow root so its styles and
 * the panel's cannot touch each other. Only the chosen timing level and the best
 * score are kept (chrome.storage.local, key "sxrts_game").
 */
(() => {
  const CSS = `
/* Layout: one centred column. A dark-green scoreboard, the side-on pitch (canvas) with a full batter whose bat stays in his hands, a commentary box, then big shot controls beside a small field map. A committed daylight-ground look: every colour is set explicitly. */
:host {
  --bg: #e9f4dc; --card: #ffffff; --ink: #17301c; --muted: #5d7a60; --board: #0f3d22; --board-ink: #ffe26a;
  --ball: #c62828; --grass: #3f9b4a; --sun: #ffb703; --sky: #3aa0ff; --line: #17301c; --good: #1d8a48; --bad: #c62828;
  --shadow: 3px 3px 0 var(--line);
  --display: ui-rounded, "Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", system-ui, sans-serif;
  --body: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color-scheme: light;
}
* { box-sizing: border-box; }
.modal { position: fixed; inset: 0; z-index: 2147483648; overflow-y: auto; background: var(--bg); color: var(--ink); font: 16px/1.45 var(--body); }
.wrap { max-width: 820px; margin-inline: auto; padding-inline: 16px; padding-block: 16px 56px; display: grid; gap: 12px; }
h1, h2 { font-family: var(--display); margin: 0; text-wrap: balance; letter-spacing: -.01em; }
button { font: inherit; color: inherit; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.logo { font: 900 26px/1 var(--display); text-transform: uppercase; } .logo i { font-style: normal; color: var(--ball); }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.btn { appearance: none; cursor: pointer; border: 2.5px solid var(--line); background: var(--card); border-radius: 12px; padding: 10px 16px; min-height: 46px; font: 800 14px/1 var(--display); box-shadow: var(--shadow); touch-action: manipulation; transition: transform .08s; }
.btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--line); }
.btn.main { background: var(--ball); color: #fff; } .btn.sun { background: var(--sun); } .btn.small { min-height: 36px; padding: 6px 12px; font-size: 12px; }
.btn.on { background: var(--sun); transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--line); }
.btn:focus-visible, canvas:focus-visible, .stance button:focus-visible, .swing:focus-visible { outline: 3px solid var(--sky); outline-offset: 2px; }
.screen[hidden] { display: none; }
.sticker { border: 2.5px solid var(--line); background: var(--card); border-radius: 16px; box-shadow: var(--shadow); padding: 16px; display: grid; gap: 12px; }
.hero h1 { font-size: clamp(32px, 8vw, 54px); line-height: .98; }
.hero p, .muted { margin: 0; color: var(--muted); }
.how { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.how li { display: grid; grid-template-columns: 32px 1fr; gap: 10px; align-items: start; }
.how b.n { width: 32px; height: 32px; border-radius: 50%; background: var(--sun); display: grid; place-items: center; font: 900 14px/1 var(--display); border: 2px solid var(--line); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.mini { border: 2px solid var(--line); border-radius: 12px; padding: 8px 10px; background: #f2f9e8; font-size: 13px; } .mini b { display: block; font: 800 14px/1.2 var(--display); }
.diff { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.board { background: var(--board); color: var(--board-ink); border: 3px solid var(--line); border-radius: 14px; padding: 10px 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; box-shadow: var(--shadow); font-variant-numeric: tabular-nums; }
.board div { min-width: 0; } .board span { display: block; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: #b9e8c4; }
.board b { font: 900 24px/1.15 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .04em; }
.need { text-align: center; font: 800 14px/1.3 var(--display); }
.stage { position: relative; border: 3px solid var(--line); border-radius: 16px; overflow: hidden; box-shadow: var(--shadow); background: #8fd0ff; }
canvas { display: block; width: 100%; height: auto; }
#cv { aspect-ratio: 2 / 1; cursor: pointer; touch-action: manipulation; }
.banner { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); max-width: 92%; background: var(--sun); border: 2.5px solid var(--line); border-radius: 12px; padding: 6px 12px; font: 800 14px/1.2 var(--display); text-align: center; box-shadow: var(--shadow); }
.banner[hidden] { display: none; }
.say { border: 2.5px solid var(--line); border-radius: 14px; background: var(--card); padding: 10px 14px; min-height: 72px; box-shadow: var(--shadow); display: grid; gap: 2px; }
.say small { font: 800 11px/1.2 var(--body); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.say span { font: 800 17px/1.3 var(--display); }
.controls { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 12px; align-items: start; }
.pad { display: grid; gap: 10px; }
.stance { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.stance button { min-height: 78px; padding: 8px 4px; border: 3px solid var(--line); border-radius: 14px; background: var(--card); font: 900 17px/1.1 var(--display); cursor: pointer; box-shadow: var(--shadow); touch-action: manipulation; display: grid; gap: 2px; place-items: center; }
.stance button i { font-style: normal; font-size: 26px; line-height: 1; }
.stance button small { font: 700 11px/1.2 var(--body); color: var(--muted); }
.stance button.on { background: var(--sun); transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--line); }
.stance button.gap::after { content: "gap"; font: 800 10px/1 var(--body); text-transform: uppercase; letter-spacing: .08em; color: var(--good); }
.stance button.risk::after { content: "fielder deep"; font: 800 10px/1 var(--body); text-transform: uppercase; letter-spacing: .06em; color: var(--bad); }
.stance button.mid::after { content: "fielder close"; font: 800 10px/1 var(--body); text-transform: uppercase; letter-spacing: .06em; color: #8a5a00; }
.swing { min-height: 132px; font: 900 34px/1 var(--display); letter-spacing: .04em; text-transform: uppercase; border: 3px solid var(--line); border-radius: 18px; background: var(--ball); color: #fff; box-shadow: var(--shadow); cursor: pointer; touch-action: manipulation; user-select: none; }
.swing:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--line); }
.swing small { display: block; font: 700 12px/1.3 var(--body); letter-spacing: .04em; text-transform: none; margin-top: 6px; opacity: .92; }
.timer { height: 10px; border-radius: 999px; border: 2px solid var(--line); background: #f2f9e8; overflow: hidden; } .timer i { display: block; height: 100%; width: 0; background: var(--ball); }
.fieldbox { border: 2.5px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--grass); box-shadow: var(--shadow); }
#fd { aspect-ratio: 1; cursor: pointer; }
.result { text-align: center; justify-items: center; } .result .big { font-size: 52px; }
.stats3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 100%; }
.stat { border: 2.5px solid var(--line); border-radius: 12px; padding: 6px 10px; background: var(--card); }
.stat span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 700; } .stat b { font: 900 20px/1.2 var(--display); }
input[type=text] { font: inherit; border: 2.5px solid var(--line); border-radius: 10px; padding: 9px 12px; background: var(--card); color: var(--ink); min-height: 44px; width: 100%; max-width: 280px; }
.code { font: 700 13px/1.2 ui-monospace, "SF Mono", Menlo, monospace; background: #f2f9e8; padding: 3px 7px; border-radius: 6px; border: 1.5px solid var(--line); }
.toast { position: fixed; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); background: var(--ink); color: #fff; padding: 10px 16px; border-radius: 999px; font-weight: 800; z-index: 9; max-width: calc(100vw - 32px); }
.toast[hidden] { display: none; }
@media (max-width: 600px) {
  .board { grid-template-columns: repeat(2, 1fr); }
  .controls { grid-template-columns: 1fr; }
  .fieldbox { max-width: 340px; margin-inline: auto; width: 100%; }
  .say span { font-size: 15px; }
  .swing { min-height: 120px; font-size: 30px; }
}
.rotate { display: none; }
@media (max-width: 600px) and (orientation: portrait) { .rotate { display: block; margin-top: 6px; } }
@media (prefers-reduced-motion: reduce) { .btn, .swing, .stance button { transition: none; } }
`;
  const MARKUP = `<main class="wrap">
  <div class="top">
    <div class="logo">Super <i>Over</i></div>
    <div class="row"><button class="btn small" id="closeGame" type="button">Back to work</button><button class="btn small" id="navSound" type="button" aria-pressed="true">Sound on</button></div>
  </div>

  <section class="screen" id="sTitle">
    <div class="sticker hero">
      <h1>Six balls. Two wickets. One very loud crowd.</h1>
      <p>You are the batter in a one-over chase. Pick your side, swing when the glowing ring says NOW, and watch your batter actually hit it. Bowlers with questionable run-ups send down bouncers, yorkers, googlies and slower balls, and two commentators have opinions about everything. Three matches make a run.</p>
      <div class="diff" role="group" aria-label="Difficulty">
        <span class="muted" style="font-weight:700">Timing:</span>
        <button class="btn small" data-diff="easy" type="button">Relaxed</button>
        <button class="btn small" data-diff="normal" type="button">Normal</button>
        <button class="btn small" data-diff="pro" type="button">Pro</button>
      </div>
      <div class="muted" id="diffNote"></div>
      <div class="row"><button class="btn main" id="goRandom" type="button">Start a run</button><button class="btn sun" id="goDaily" type="button">Today's matches</button></div>
      <div class="row"><input type="text" id="codeIn" placeholder="Have a match code? SO-xxxx" aria-label="Match code"><button class="btn small" id="codeGo" type="button">Play it</button></div>
      <div class="muted" id="codeMsg"></div>
    </div>
    <div class="sticker" style="margin-top:12px">
      <ul class="how">
        <li><b class="n">1</b><span>Tap <b>Off side</b>, <b>Straight</b> or <b>Leg side</b>. Each button tells you if there is a gap or a fielder there.</span></li>
        <li><b class="n">2</b><span>The bowler runs in. When the ring at your bat glows green and says <b>NOW</b>, hit the big <b>SWING</b> button (or Space, or tap the pitch). You do not need to be exact: a wide window scores.</span></li>
        <li><b class="n">3</b><span>Perfect timing into a gap is a six. Good timing is a four. Even a late swing usually scrapes a run. After every shot a strip shows if you were early or late.</span></li>
        <li><b class="n">4</b><span>Score on back-to-back balls and you catch fire: your timing window grows. Reach the target before the over ends or two wickets fall.</span></li>
      </ul>
    </div>
  </section>

  <section class="screen" id="sIntro" hidden>
    <div class="sticker">
      <div class="muted" id="iNo">Match 1 of 3</div>
      <h2 id="iPlace">The Gully</h2>
      <div class="cards">
        <div class="mini"><b>The chase</b><span id="iTarget"></span></div>
        <div class="mini"><b>Ground</b><span id="iTag"></span></div>
        <div class="mini"><b>Today's mood</b><span id="iMood"></span></div>
      </div>
      <p class="muted" id="iNote" style="margin:0"></p>
      <div class="row"><button class="btn main" id="goPlay" type="button">Walk out to bat</button></div>
    </div>
  </section>

  <section class="screen" id="sGame" hidden>
    <div class="board">
      <div><span>Score</span><b id="hScore">0/0</b></div>
      <div><span>Overs</span><b id="hOver">0.0</b></div>
      <div><span>Target</span><b id="hTarget">14</b></div>
      <div><span>Bowler</span><b id="hBowler" style="font-size:13px;letter-spacing:0">-</b></div>
    </div>
    <div class="need" id="need" style="margin-top:8px"></div>
    <div class="muted rotate" style="font-size:12px;text-align:center">Tip: turn your phone sideways for a bigger pitch.</div>
    <div class="stage" style="margin-top:8px">
      <canvas id="cv" width="800" height="400" tabindex="0" aria-label="The pitch. Tap, or press Space, to swing."></canvas>
      <div class="banner" id="banner" hidden></div>
    </div>
    <div class="say" id="say" style="margin-top:10px" aria-live="polite"><small id="sayWho">Commentary</small><span id="sayText"></span></div>
    <div class="controls" style="margin-top:10px">
      <div class="pad">
        <div class="stance" id="stance">
          <button type="button" data-z="0"><i>&#9664;</i>Off side<small>key A</small></button>
          <button type="button" data-z="1"><i>&#9650;</i>Straight<small>key S</small></button>
          <button type="button" data-z="2"><i>&#9654;</i>Leg side<small>key D</small></button>
        </div>
        <div class="timer" aria-hidden="true"><i id="tm"></i></div>
        <button class="swing" id="swing" type="button">Swing!<small>Space, or tap the pitch</small></button>
        <div class="row"><button class="btn small" id="bowlNow" type="button">Bowl now</button><span class="muted" id="hint" style="font-size:13px">Pick a side, then swing when the ring says NOW.</span></div>
      </div>
      <div class="fieldbox"><canvas id="fd" width="360" height="360" aria-label="Field map. Tap a section to choose where to hit."></canvas></div>
    </div>
  </section>

  <section class="screen" id="sResult" hidden>
    <div class="sticker result">
      <div class="big" id="rIcon" aria-hidden="true">&#127951;</div>
      <h2 id="rTitle"></h2>
      <p class="muted" id="rText" style="margin:0"></p>
      <div class="stats3">
        <div class="stat"><span>Score</span><b id="rScore"></b></div>
        <div class="stat"><span>Sixes / fours</span><b id="rBound"></b></div>
        <div class="stat"><span>Stars</span><b id="rStars"></b></div>
      </div>
      <div class="muted" id="rCode"></div>
      <div class="row"><button class="btn main" id="rNext" type="button">Next</button><button class="btn" id="rMenu" type="button">Menu</button></div>
    </div>
  </section>
</main>
<div class="toast" id="toast" hidden></div>`;

  function mount(panelShadow) {
    const host = document.createElement("div");
    host.className = "sx-game-host";
    host.hidden = true;
    const sr = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.tabIndex = -1;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-label", "Super Over, a cricket game");
    modal.innerHTML = MARKUP;
    sr.append(style, modal);
    panelShadow.appendChild(host);

  var $ = function (id) { return sr.getElementById(id); };
  var cv = $("cv"), ctx = cv.getContext("2d"), fd = $("fd"), fx = fd.getContext("2d");
  var W = 800, H = 400, GY = 338, X0 = 185, X1 = 540, STUMPS = 712, BX = 646, LEAD = 110;

  // ---------- content (all offline) ----------
  var PLACES = [
    { n: "The Gully", sky: ["#8fd0ff", "#e8f7ff"], grass: "#6bb356", crowd: ["#ff6f61", "#ffd166", "#06d6a0", "#118ab2", "#ef476f"], tag: "Neighbours on every balcony.", mood: "Windy, with a dog on patrol." },
    { n: "The Rooftop Mela", sky: ["#ffc2a1", "#fff0dc"], grass: "#b9a06b", crowd: ["#e63946", "#f4a261", "#2a9d8f", "#e9c46a", "#9b5de5"], tag: "Kites overhead, samosas below.", mood: "Festive. The ball can land in a water tank." },
    { n: "The Floodlit Maidan", sky: ["#142a63", "#3d5aa8"], grass: "#2f8a49", crowd: ["#fff176", "#ffffff", "#ffab91", "#80deea", "#ce93d8"], tag: "Under the lights, with moths.", mood: "Dew on the grass. Slippery." },
    { n: "Beach Cricket", sky: ["#8fe0ff", "#ffeab6"], grass: "#f1d696", crowd: ["#ff5d8f", "#ffd23f", "#3bceac", "#0ead69", "#ee4266"], tag: "A crab has an opinion on lbw.", mood: "Sunny. The ball keeps going in the sea." },
    { n: "The School Ground", sky: ["#9bd7ff", "#f0fbff"], grass: "#58a853", crowd: ["#4361ee", "#f72585", "#ffd60a", "#4cc9f0", "#b5179e"], tag: "A teacher with a whistle and no mercy.", mood: "Recess is ending. Everyone is nervous." },
    { n: "The Village Mela Ground", sky: ["#ffd9a8", "#fff6e3"], grass: "#a7b562", crowd: ["#d62828", "#f77f00", "#fcbf49", "#3a86ff", "#8338ec"], tag: "A Ferris wheel watches from behind the stumps.", mood: "Hot. Someone is selling cold lassi." }
  ];
  var FIELDERS = ["Guddu", "Pintu", "Bunty", "Chintu", "Sonu", "Monu", "Bablu", "Tinku", "Golu", "Pappu", "Rinku", "Lallu"];
  var DEL = {
    fast: { T: 800, f: 1, bounce: 0.6, reb: 24, hBat: 44, label: "Fast one!" },
    straight: { T: 1120, f: 1, bounce: 0.62, reb: 30, hBat: 46, label: "Medium pace" },
    bouncer: { T: 900, f: 1, bounce: 0.44, reb: 64, hBat: 104, label: "BOUNCER!" },
    yorker: { T: 860, f: 1, bounce: 0.86, reb: 6, hBat: 8, label: "YORKER!" },
    slower: { T: 1120, f: 0.58, bounce: 0.6, reb: 36, hBat: 42, label: "Slower ball..." },
    googly: { T: 1060, f: 1.5, bounce: 0.6, reb: 30, hBat: 44, label: "GOOGLY!" }
  };
  var BOWLERS = [
    { n: "Raju the Rocket", d: ["bouncer", "fast", "fast", "yorker"], talk: ["Dekh, ye ball tujhe yaad rahegi!", "Seat belt baandh le, batter!"] },
    { n: "Spinning Sunil", d: ["googly", "slower", "straight", "googly"], talk: ["It will turn. Or it won't. Surprise!", "Meri spin se bachna mushkil hai."] },
    { n: "Uncle Ji (retired)", d: ["slower", "slower", "googly", "straight"], talk: ["In my day we bowled slower than this.", "Beta, patience hai toh run milega."] },
    { n: "The Intern", d: ["fast", "straight", "bouncer", "yorker", "slower", "googly"], talk: ["Nobody told me what to bowl, so... this.", "I read about yorkers last night."] },
    { n: "Bouncer Bhai", d: ["bouncer", "bouncer", "yorker", "fast"], talk: ["Helmet theek se pehen le.", "Upar dekh, upar!"] },
    { n: "Yorker Yogi", d: ["yorker", "yorker", "fast", "straight"], talk: ["Toes. I am going for your toes.", "Boot laces. Always the boot laces."] },
    { n: "Googly Gopal", d: ["googly", "googly", "straight", "slower"], talk: ["Left or right? Even I don't know.", "My googly has a googly."] },
    { n: "Aunty's Nephew", d: ["straight", "straight", "slower", "fast"], talk: ["Mummy is watching, so be gentle.", "I only bowl because it's my turn."] }
  ];
  var EVENTS = [
    { k: "dog", t: "A dog runs onto the pitch!", note: "Bowler pauses, ball comes a bit slower." },
    { k: "wind", t: "A sudden gust of wind!", note: "The ball swings oddly." },
    { k: "glare", t: "Sun glare! The ball flickers.", note: "Watch the ball when it reappears." },
    { k: "tennis", t: "Someone swapped in a tennis ball!", note: "It bounces higher and slower." },
    { k: "hat", t: "The umpire's hat blows away: FREE HIT!", note: "You cannot get out this ball." },
    { k: "wave", t: "The crowd starts a Mexican wave!", note: "Nothing changes, but everyone is dizzy." }
  ];
  var C_SIX = ["SIX! That's gone into the neighbour's balcony!", "SIX! The ball has left the street and possibly the state!", "Out of the park! Someone's chai just became a cricket ball cocktail.", "MAXIMUM! The ball is now a satellite.", "Huge hit! The ball is asking for directions home."];
  var C_FOUR = ["FOUR! Raced to the boundary and even the dog gave up.", "FOUR! Timed like a wedding muhurat.", "Beautifully placed. Gap found, aunties cheer.", "FOUR! It rolled all the way to the chai stall."];
  var C_RUN = ["They scamper through for {n}. Quick feet, shaky knees.", "{N} taken. Running like they're late for dinner.", "Pushed into the gap for {n}."];
  var C_DOT = ["Dot ball. Tight bowling, tighter nerves.", "Nothing doing. The bat made a nice breeze, though.", "Dot ball. The crowd breathes out."];
  var C_BOWLED = ["BOWLED! Stumps everywhere! The bails fly to another postcode.", "Clean bowled! The batter stares at the bat like it betrayed them.", "Timber! That is a stump-sized disaster."];
  var C_CAUGHT = ["CAUGHT! {f} takes it and also takes a bow.", "Caught in the deep! Big hit, bigger disappointment.", "In the air... and into the hands of {f}!"];
  var C_DROP = ["DROPPED! {f} has dropped the catch and his dignity. That's FOUR!", "Oh no, {f}! The ball went through his hands like a rumour. FOUR!"];
  var C_EDGE = ["A thick edge! It dribbles away to the {side}.", "Off the edge and it trickles to the {side}. Lucky!", "That's an edge. The bat is blaming the ball."];
  var C_FREE = ["Free hit and a lot of confidence.", "The umpire says you cannot get out. The crowd says swing."];
  var COMM = ["Chotu on the mic", "Expert Uncle"];
  var BANTER = ["Expert Uncle says that in 1983 they did this with a broom.", "Chotu says he has never seen such confidence from someone this nervous.", "Expert Uncle claims the pitch is 'a bit sticky, like halwa'.", "Chotu says the stumps look scared."];
  var RANKS = [[0, ["Net Practice Hero", "Tennis-Ball Beginner", "Gully Rookie"]], [3, ["Reliable Opener", "Wall of the Mohalla", "Last-Over Hero"]], [6, ["Super Over Specialist", "The Finisher", "Match-Winner of the Colony"]], [8, ["Legend of the Last Ball", "Maidan Maharaja", "Six-Hitting Superstar"]]];


  var DIFF = {
    easy: { n: "Relaxed", perfect: 90, good: 185, edge: 310, T: 1.2, assist: true, targets: [14, 17, 20], note: "Big timing windows, slower bowling, and a NOW ring to guide you. Best for getting runs." },
    normal: { n: "Normal", perfect: 70, good: 150, edge: 260, T: 1.0, assist: true, targets: [16, 19, 22], note: "Fair windows with the NOW ring. A good balance." },
    pro: { n: "Pro", perfect: 48, good: 105, edge: 200, T: 0.9, assist: false, targets: [18, 21, 24], note: "Tight windows, faster bowling, no ring. For people who like pain." }
  };
  var diffKey = "easy";
  var ZN = ["Off side", "Straight", "Leg side"];

  // ---------- helpers ----------
  function mulberry(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function pick(rng, l) { return l[Math.floor(rng() * l.length)]; }
  function shuffle(rng, l) { var a = l.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  var prefs = {};
  function store(k, v) {
    if (v === undefined) return prefs[k] === undefined ? null : prefs[k];
    prefs[k] = v;
    try { chrome.storage.local.set({ sxrts_game: prefs }); } catch (e) { /* preferences are optional */ }
    return null;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  var soundOn = true, audio = null;
  function tone(f, d, type, g, delay, slide) {
    if (!soundOn) return;
    setTimeout(function () { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); var o = audio.createOscillator(), gn = audio.createGain(); o.type = type || "triangle"; o.frequency.value = f; if (slide) o.frequency.linearRampToValueAtTime(slide, audio.currentTime + d); gn.gain.value = g || 0.05; gn.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + d); o.connect(gn); gn.connect(audio.destination); o.start(); o.stop(audio.currentTime + d); } catch (e) { /* sound is optional */ } }, delay || 0);
  }
  var whoosh = function () { tone(500, 0.12, "sawtooth", 0.03, 0, 180); };
  var thock = function () { tone(180, 0.1, "square", 0.09, 0, 90); tone(900, 0.04, "square", 0.04); };
  var cheer = function () { [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.22, "triangle", 0.05, i * 80); }); };
  var groan = function () { tone(200, 0.4, "sawtooth", 0.05, 0, 90); };
  function toast(t) { var e = $("toast"); e.textContent = t; e.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(function () { e.hidden = true; }, 1800); }
  var SCREENS = ["sTitle", "sIntro", "sGame", "sResult"];
  function show(id) { SCREENS.forEach(function (s) { $(s).hidden = s !== id; }); modal.scrollTop = 0; }

  // ---------- run state ----------
  var R = null, G = null, raf = 0;
  function setDiff(k) {
    diffKey = k; store("so-diff", k);
    Array.prototype.forEach.call(sr.querySelectorAll("[data-diff]"), function (b) { b.classList.toggle("on", b.dataset.diff === k); });
    $("diffNote").textContent = DIFF[k].note;
  }
  function newRun(code, daily) {
    var d = new Date();
    var seed = code ? parseInt(code, 36) : daily ? hash("so-" + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate()) % 1679616 : Math.floor(Math.random() * 1679615) + 1;
    R = { seed: seed, code: "SO-" + seed.toString(36).toUpperCase().padStart(4, "0"), match: 0, stars: 0, runs: 0, sixes: 0, fours: 0, results: [], diff: diffKey };
    R.places = shuffle(mulberry(seed), PLACES.map(function (_, i) { return i; })).slice(0, 3);
    intro();
  }
  function intro() {
    var rng = mulberry(hash(R.code + "m" + R.match)), pl = PLACES[R.places[R.match]], D = DIFF[R.diff];
    var target = D.targets[R.match] + Math.floor(rng() * 3);
    G = { place: pl, target: target, runs: 0, wk: 0, balls: 0, delivered: 0, six: 0, four: 0, streak: 0, rngBase: hash(R.code + "b" + R.match), phase: "intro", stance: 1, D: D };
    $("iNo").textContent = "Match " + (R.match + 1) + " of 3 · " + D.n + " timing"; $("iPlace").textContent = pl.n;
    $("iTarget").textContent = target + " off 6 balls, 2 wickets in hand"; $("iTag").textContent = pl.tag; $("iMood").textContent = pl.mood;
    $("iNote").textContent = R.match === 0 ? "Tip: press SWING a split second before the ball reaches your bat. The ring glows green when it is time." : pick(mulberry(hash(R.code + "n" + R.match)), ["The bowlers have been warned about you.", "The captain is rubbing his hands. Never a good sign.", "Somebody's grandmother is already making a speech."]);
    show("sIntro");
  }
  function beginMatch() { show("sGame"); setupBall(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }
  function ballRng() { return mulberry(G.rngBase + G.delivered * 7919); }

  function setupBall() {
    var rng = ballRng(), bow = pick(rng, BOWLERS), key = pick(rng, bow.d), d = Object.assign({}, DEL[key]);
    d.T *= G.D.T;
    G.bowler = bow; G.key = key; G.d = d; G.talk = pick(rng, bow.talk);
    var types = [];
    for (var i = 0; i < 3; i++) { var r = rng(); types.push(r < 0.35 ? "none" : r < 0.75 ? "close" : "deep"); }
    if (types.every(function (t) { return t !== "none"; })) types[Math.floor(rng() * 3)] = "none";
    var names = shuffle(rng, FIELDERS);
    G.field = types.map(function (t, i) { return { type: t, name: names[i] }; });
    G.event = null; G.free = false;
    if (rng() < 0.28) G.event = pick(rng, EVENTS);
    if (G.event) { var k = G.event.k; if (k === "dog") d.T *= 1.25; else if (k === "wind") d.f *= rng() < 0.5 ? 0.85 : 1.2; else if (k === "tennis") { d.reb *= 1.6; d.T *= 1.1; d.f *= 0.9; } else if (k === "hat") G.free = true; }
    G.phase = "set"; G.setT0 = performance.now(); G.setDur = 2400; G.out = null; G.applied = false; G.pressT = null; G.swingT = null; G.launch = null; G.fa = null; G.shake = 0; G.sparks = []; G.trail = []; G.tl = timeline(d);
    // a good stance is chosen for the player at first: the emptiest side
    var rank = { none: 0, close: 1, deep: 2 }, best = G.stance;
    G.field.forEach(function (f, z) { if (rank[f.type] < rank[G.field[best].type]) best = z; });
    G.bestZone = best;
    $("hBowler").textContent = bow.n;
    banner(G.event ? G.event.t : ""); say(COMM[0], G.event && G.event.note ? G.event.note : bow.n + ": “" + G.talk + "”");
    $("hint").textContent = "Pick a side, then swing when the ring says NOW."; $("bowlNow").hidden = false;
    hud(); drawField();
  }
  function banner(t) { G.bannerT = t ? 3 : 0; var b = $("banner"); b.hidden = !t; b.textContent = t || ""; }
  function say(who, text) { $("sayWho").textContent = who; $("sayText").textContent = text; }
  function hud() {
    $("hScore").textContent = G.runs + "/" + G.wk; $("hOver").textContent = Math.floor(G.balls / 6) + "." + (G.balls % 6); $("hTarget").textContent = G.target;
    var need = G.target - G.runs, left = 6 - G.balls;
    $("need").textContent = need > 0 ? "Need " + need + " off " + left + " ball" + (left === 1 ? "" : "s") + " · " + (2 - G.wk) + " wicket" + (2 - G.wk === 1 ? "" : "s") + " in hand" + (G.streak >= 2 ? " · 🔥 on fire x" + G.streak : "") : "Target reached!";
    Array.prototype.forEach.call($("stance").children, function (b) {
      var z = +b.dataset.z, f = G.field && G.field[z];
      b.classList.toggle("on", z === G.stance);
      b.classList.toggle("gap", !!f && f.type === "none"); b.classList.toggle("mid", !!f && f.type === "close"); b.classList.toggle("risk", !!f && f.type === "deep");
    });
  }

  // ---------- ball timeline ----------
  function timeline(d) { var d1 = d.bounce, d2 = 1 - d1, t1 = d1 * d.T, t2 = d2 * d.T / d.f; return { t1: t1, t2: t2, total: t1 + t2, d1: d1, v2: (X1 - X0) * d2 / t2 }; }
  function ballAt(e, d, tl) {
    e = Math.max(0, e);
    var u = e < tl.t1 ? (e / tl.t1) * tl.d1 : tl.d1 + ((e - tl.t1) / tl.t2) * (1 - tl.d1), x, h;
    if (e > tl.total) { x = X1 + tl.v2 * (e - tl.total); h = Math.max(0, d.hBat * (1 - (e - tl.total) / 160)); u = 1 + (e - tl.total) / 400; }
    else {
      x = X0 + (X1 - X0) * u;
      if (u < tl.d1) h = 112 * (1 - Math.pow(u / tl.d1, 1.5)); else { var s = Math.min(1, (u - tl.d1) / (1 - tl.d1)); h = d.hBat * s + d.reb * Math.sin(Math.PI * s); }
    }
    var wind = G.event && G.event.k === "wind" ? Math.sin(Math.min(u, 1) * 7) * 6 : 0;
    return { x: x, y: GY - 6 - Math.max(0, h) + wind, u: u, r: 6 + Math.min(1, u) * 7, h: h };
  }
  function startBowl() {
    G.phase = "run"; G.runT0 = performance.now(); G.runDur = 760; G.releaseT = G.runT0 + G.runDur; G.arriveAt = G.releaseT + G.tl.total;
    G.missAt = G.arriveAt + clamp((STUMPS - 20 - X1) / G.tl.v2, 120, 520);
    say(COMM[0], G.d.label + " Pick the gap and get ready."); whoosh(); $("bowlNow").hidden = true;
  }

  // ---------- input ----------
  function setStance(z) { if (G && (G.phase === "set" || G.phase === "run") && !G.pressT) { G.stance = z; hud(); drawField(); tone(420 + z * 60, 0.05, "triangle", 0.04); } }
  function windows() {
    var D = G.D, bonus = Math.min(24, G.streak * 8);
    return { perfect: D.perfect + bonus, good: D.good + bonus, edge: D.edge + bonus };
  }
  function swing() {
    if (!G || G.pressT !== null) return;
    if (G.phase === "set") { G.setT0 = performance.now() - G.setDur; $("hint").textContent = "Bowler is on the way. Swing when the ring says NOW."; return; }
    if (G.phase !== "run" && G.phase !== "flight") return;
    var now = performance.now(); G.pressT = now; G.swingT = now; G.contactT = now + LEAD; whoosh();
    G.delta = G.contactT - G.arriveAt; G.out = judge(G.delta);
    var tgt = G.out.q === "miss" ? ballAt(G.arriveAt - G.releaseT, G.d, G.tl) : ballAt(G.contactT - G.releaseT, G.d, G.tl);
    setBatPose(tgt);
  }
  function judge(delta) {
    var rng = mulberry(G.rngBase + G.delivered * 104729 + 17), z = G.stance, w = windows(), abs = Math.abs(delta), late = delta > 0;
    var o = { q: "", zone: z, runs: 0, wicket: false, kind: "", f: null, delta: delta };
    var edgeLim = late ? w.edge * 0.8 : w.edge;
    if (delta === 9999 || abs > edgeLim) {
      o.q = "miss";
      var out = delta === 9999 ? true : abs > w.edge + 170 ? true : rng() < (G.D === DIFF.easy ? 0.12 : 0.22);
      o.kind = out && !G.free ? "bowled" : "dot"; o.wicket = o.kind === "bowled"; return o;
    }
    if (abs > w.good) {
      o.q = "edge"; o.zone = delta < 0 ? 2 : 0; var fe = G.field[o.zone]; o.f = fe;
      if (fe.type === "close" && rng() < 0.3 && !G.free) { o.kind = "caught"; o.wicket = true; }
      else if (fe.type === "close") { o.kind = "dot"; }
      else { o.kind = "run"; o.runs = 1; }
      return o;
    }
    var f = G.field[z]; o.f = f;
    if (abs <= w.perfect) {
      o.q = "perfect";
      if (f.type === "deep") { var r = rng(); if (r < 0.4 && !G.free) { o.kind = "caught"; o.wicket = true; } else if (r < 0.6) { o.kind = "dropped"; o.runs = 4; } else { o.kind = "six"; o.runs = 6; } }
      else { o.kind = "six"; o.runs = 6; }
    } else {
      o.q = "good";
      if (f.type === "none") { o.kind = "four"; o.runs = 4; }
      else if (f.type === "close") { o.kind = "run"; o.runs = 1; }
      else { o.kind = "run"; o.runs = 2; }
    }
    return o;
  }
  function label(delta, q) {
    if (delta === 9999) return "No swing";
    var ms = Math.round(Math.abs(delta));
    if (q === "perfect") return "PERFECT!";
    if (q === "good") return delta < 0 ? "GOOD (a touch early)" : "GOOD (a touch late)";
    if (q === "edge") return delta < 0 ? "EARLY, " + ms + " ms" : "LATE, " + ms + " ms";
    return delta < 0 ? "TOO EARLY, " + ms + " ms" : "TOO LATE, " + ms + " ms";
  }
  function apply() {
    if (G.applied) return; G.applied = true;
    var o = G.out, rng = ballRng(), now = performance.now();
    G.phase = "result"; G.resultT0 = now; G.delivered++; G.balls++;
    G.timing = { delta: G.delta === undefined || G.pressT === null ? 9999 : G.delta, q: o.q, text: label(G.pressT === null ? 9999 : G.delta, o.q) };
    var text = "", who = pick(rng, COMM), contact = o.q !== "miss";
    if (contact) {
      var cb = ballAt((G.contactT || now) - G.releaseT, G.d, G.tl);
      G.launch = { x: cb.x, y: cb.y, t0: now, kind: o.kind, zone: o.zone, q: o.q };
      G.shake = o.q === "perfect" ? 8 : 4; spark(cb.x, cb.y, o.q === "perfect" ? 18 : 9);
      thock();
    }
    if (o.kind === "six") { G.runs += 6; G.six++; text = pick(rng, C_SIX); cheer(); }
    else if (o.kind === "four") { G.runs += 4; G.four++; text = pick(rng, C_FOUR); cheer(); }
    else if (o.kind === "dropped") { G.runs += 4; G.four++; text = pick(rng, C_DROP).replace("{f}", o.f.name); cheer(); }
    else if (o.kind === "run") {
      G.runs += o.runs;
      if (o.q === "edge") text = pick(rng, C_EDGE).replace("{side}", o.zone === 2 ? "leg side" : "off side");
      else text = pick(rng, C_RUN).replace("{n}", o.runs === 1 ? "a single" : o.runs + " runs").replace("{N}", o.runs === 1 ? "One run" : o.runs + " runs");
    }
    else if (o.kind === "dot") { text = o.q === "miss" ? "A big swing and a miss! " + pick(rng, C_DOT) : pick(rng, C_DOT); }
    else if (o.kind === "bowled") { G.wk++; text = (G.pressT === null ? "He didn't even swing! " : "") + pick(rng, C_BOWLED); groan(); }
    else if (o.kind === "caught") { G.wk++; text = pick(rng, C_CAUGHT).replace("{f}", o.f.name); groan(); }
    if (G.free && o.kind === "dot" && o.q !== "miss") text += " Free hit, so no wicket.";
    if (rng() < 0.25) text += " " + pick(rng, BANTER);
    // fire: scoring on back-to-back balls widens the window
    if (o.runs > 0) G.streak++; else G.streak = 0;
    say(who, text);
    G.fa = { t0: now, o: o };
    hud();
    G.nextAt = now + (o.kind === "six" ? 3000 : 2500);
    if (G.runs >= G.target) { G.ending = "win"; G.nextAt = now + 2000; }
    else if (G.wk >= 2 || G.balls >= 6) { G.ending = "lose"; G.nextAt = now + 2000; }
    else G.ending = null;
  }
  function spark(x, y, n) { for (var i = 0; i < n; i++) { var a = Math.random() * 6.28, s = 80 + Math.random() * 260; G.sparks.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.5 + Math.random() * 0.3, max: 0.8 }); } }

  // ---------- loop ----------
  var lastNow = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!G || $("sGame").hidden) return;
    var dt = Math.min(0.05, (now - (lastNow || now)) / 1000); lastNow = now;
    if (G.phase === "set") {
      var p = Math.min(1, (now - G.setT0) / G.setDur); $("tm").style.width = (p * 100) + "%";
      if (p >= 1) startBowl();
    } else if (G.phase === "run") {
      $("tm").style.width = "100%"; if (now >= G.releaseT) G.phase = "flight";
    } else if (G.phase === "flight") {
      if (G.out && !G.applied) {
        var when = G.out.q === "miss" ? G.missAt : G.contactT;
        if (now >= when) apply();
      } else if (!G.out && now >= G.missAt) { G.out = judge(9999); G.pressT = null; apply(); }
    } else if (G.phase === "result") {
      if (now >= G.nextAt) { G.phase = "wait"; nextBall(); }
    }
    if (G.bannerT > 0) { G.bannerT -= dt; if (G.bannerT <= 0) banner(""); }
    if (G.shake > 0) G.shake = Math.max(0, G.shake - dt * 28);
    if (G.sparks) G.sparks.forEach(function (s) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 700 * dt; });
    draw(now); drawField(now);
  }
  function nextBall() { if (G.ending) { endMatch(G.ending === "win"); return; } setupBall(); }

  // ---------- drawing: pitch ----------
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  var BAT_BACK = -2.5;
  function setBatPose(target) {
    var L = 86, hx0 = BX - 36, hy0 = GY - 74;
    var cosT = clamp((target.y - hy0) / L, -0.92, 0.96), th = Math.acos(cosT);
    G.bat = { th: th, shift: clamp(target.x - (hx0 - Math.sin(th) * L), -40, 40) };
  }
  function batState(now) {
    var idle = BAT_BACK + Math.sin(now / 420) * 0.05;
    if (!G.swingT || !G.bat) return { th: idle, shift: 0, p: 0, follow: 0 };
    var dt = now - G.swingT, th0 = BAT_BACK, thc = G.bat.th;
    if (dt < LEAD) { var p = dt / LEAD, e = p * p * (3 - 2 * p) * 0.35 + Math.pow(p, 2.2) * 0.65; return { th: th0 + (thc - th0) * e, shift: G.bat.shift * p, p: p, follow: 0 }; }
    var f = (dt - LEAD) / 260;
    if (f < 1) { var ef = 1 - Math.pow(1 - f, 2); return { th: thc + 1.05 * ef, shift: G.bat.shift, p: 1, follow: ef }; }
    if (dt < LEAD + 260 + 600) return { th: thc + 1.05, shift: G.bat.shift, p: 1, follow: 1 };
    var r = Math.min(1, (dt - LEAD - 860) / 400);
    return { th: thc + 1.05 + (idle - thc - 1.05) * r, shift: G.bat.shift * (1 - r), p: 1 - r, follow: 1 - r };
  }
  function draw(now) {
    var P = G.place;
    ctx.save();
    if (G.shake > 0) ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
    var g = ctx.createLinearGradient(0, 0, 0, 240); g.addColorStop(0, P.sky[0]); g.addColorStop(1, P.sky[1]);
    ctx.fillStyle = g; ctx.fillRect(-10, -10, W + 20, H + 20);
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(0, 150, W, 80);
    for (var r = 0; r < 3; r++) for (var i = 0; i < 52; i++) {
      var wave = G.event && G.event.k === "wave" ? Math.sin(now / 160 - i * 0.35) * 8 : 0;
      ctx.fillStyle = P.crowd[(i + r * 2) % P.crowd.length]; ctx.beginPath(); ctx.arc(8 + i * 15.5 + (r % 2) * 6, 176 + r * 19 + wave, 5.5, 0, 7); ctx.fill();
    }
    ctx.fillStyle = P.grass; ctx.fillRect(-10, 236, W + 20, H);
    ctx.fillStyle = "rgba(255,255,255,.08)"; for (var s = 0; s < 8; s++) ctx.fillRect(s * 110, 236, 55, H);
    ctx.fillStyle = "#d6b583"; ctx.beginPath(); ctx.moveTo(110, 316); ctx.lineTo(730, 316); ctx.lineTo(780, 384); ctx.lineTo(60, 384); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(612, 316); ctx.lineTo(600, 384); ctx.stroke();
    var bowledNow = G.launch === null && G.out && G.out.kind === "bowled" && G.phase === "result";
    drawStumps(STUMPS, GY, bowledNow ? Math.min(1, (now - G.resultT0) / 350) : 0); drawStumps(104, GY, 0);
    drawBowler(now); drawBatter(now);
    // strike-zone ring with NOW assist
    if (G.phase !== "result" && G.phase !== "wait") {
      var dd = (now + LEAD) - (G.arriveAt || 1e12), w = windows(), live = G.phase === "flight" || G.phase === "run";
      var inP = live && Math.abs(dd) <= w.perfect, inG = live && Math.abs(dd) <= w.good;
      ctx.lineWidth = inG ? 5 : 2.5; ctx.setLineDash(inG ? [] : [5, 6]);
      ctx.strokeStyle = G.D.assist && inP ? "#1de26a" : G.D.assist && inG ? "#ffd23f" : "rgba(198,40,40,.5)";
      ctx.beginPath(); ctx.ellipse(X1, GY - 52, 40, 54, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      if (G.D.assist && inP && !G.pressT) { ctx.fillStyle = "#1de26a"; ctx.strokeStyle = "#0b3d1d"; ctx.lineWidth = 6; ctx.font = "900 44px ui-rounded, Trebuchet MS, system-ui"; ctx.textAlign = "center"; ctx.strokeText("NOW!", X1, 150); ctx.fillText("NOW!", X1, 150); }
    }
    // ball
    var ballPos = null, hide = false;
    if (G.phase === "run") { var t = clamp((now - G.runT0) / G.runDur, 0, 1); ballPos = { x: 40 + t * 120 + 8, y: 232 + (1 - t) * 8, r: 6, h: 0 }; }
    else if (G.phase === "flight") { ballPos = ballAt(now - G.releaseT, G.d, G.tl); hide = G.event && G.event.k === "glare" && ballPos.u > 0.28 && ballPos.u < 0.62; }
    else if (G.phase === "result" && G.launch) ballPos = launchBall(now);
    else if (G.phase === "result") ballPos = ballAt(Math.min(now - G.releaseT, G.missAt - G.releaseT), G.d, G.tl);
    if (ballPos && !hide) {
      if (G.phase === "flight" || (G.phase === "result" && !G.launch)) { G.trail.push({ x: ballPos.x, y: ballPos.y }); if (G.trail.length > 9) G.trail.shift(); }
      G.trail.forEach(function (tp, i) { ctx.fillStyle = "rgba(198,40,40," + (i / G.trail.length * 0.28) + ")"; ctx.beginPath(); ctx.arc(tp.x, tp.y, ballPos.r * (0.4 + i / G.trail.length * 0.5), 0, 7); ctx.fill(); });
      ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(ballPos.x, GY + 2, ballPos.r * 1.2, 3, 0, 0, 7); ctx.fill();
      ctx.fillStyle = G.event && G.event.k === "tennis" ? "#d8ff3a" : "#d32f2f"; ctx.beginPath(); ctx.arc(ballPos.x, ballPos.y, ballPos.r, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ballPos.x, ballPos.y, ballPos.r * 0.62, 0.5, 2.4); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.arc(ballPos.x - ballPos.r * 0.3, ballPos.y - ballPos.r * 0.3, ballPos.r * 0.2, 0, 7); ctx.fill();
    }
    if (hide) { ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.font = "800 16px system-ui"; ctx.textAlign = "center"; ctx.fillText("☀ glare! watch for it", 400, 120); }
    if (G.event && G.event.k === "dog" && (G.phase === "set" || G.phase === "run")) { var dx = ((now / 6) % 900) - 50; ctx.font = "36px system-ui, 'Apple Color Emoji', 'Noto Color Emoji'"; ctx.textAlign = "center"; ctx.fillText("🐕", dx, 372); }
    // sparks
    (G.sparks || []).forEach(function (sp) { if (sp.life > 0) { ctx.globalAlpha = Math.max(0, sp.life / sp.max); ctx.fillStyle = "#ffe26a"; ctx.beginPath(); ctx.arc(sp.x, sp.y, 3, 0, 7); ctx.fill(); ctx.globalAlpha = 1; } });
    ctx.restore();
    // result overlay: big call-out and a timing strip
    if (G.phase === "result" && G.out) {
      var big = G.out.kind === "six" ? "SIX!" : G.out.kind === "four" || G.out.kind === "dropped" ? "FOUR!" : G.out.kind === "bowled" ? "BOWLED!" : G.out.kind === "caught" ? "OUT!" : G.out.kind === "run" ? G.out.runs + (G.out.runs === 1 ? " RUN" : " RUNS") : "DOT BALL";
      var k = Math.min(1, (now - G.resultT0) / 220);
      ctx.save(); ctx.translate(400, 86); ctx.scale(0.6 + k * 0.5, 0.6 + k * 0.5); ctx.rotate(-0.05); ctx.fillStyle = G.out.wicket ? "#c62828" : G.out.runs >= 4 ? "#ffb703" : "#ffffff"; ctx.strokeStyle = "#17301c"; ctx.lineWidth = 7; ctx.font = "900 " + (big.length > 6 ? 56 : 80) + "px ui-rounded, Trebuchet MS, system-ui"; ctx.textAlign = "center"; ctx.lineJoin = "round"; ctx.strokeText(big, 0, 0); ctx.fillText(big, 0, 0); ctx.restore();
      drawStrip(now);
    }
  }
  function drawStrip(now) {
    var T = G.timing; if (!T) return;
    var x = 24, y = 360, w = 300, h = 14, w_ = windows();
    var half = 420, sx = function (d) { return x + (clamp(d, -half, half) + half) / (2 * half) * w; };
    ctx.save(); ctx.fillStyle = "rgba(255,255,255,.9)"; rr(ctx, x - 10, y - 30, w + 20, 58, 10); ctx.fill(); ctx.strokeStyle = "#17301c"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#ef9a9a"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#ffe082"; ctx.fillRect(sx(-w_.edge), y, sx(w_.edge * 0.8) - sx(-w_.edge), h);
    ctx.fillStyle = "#a5d6a7"; ctx.fillRect(sx(-w_.good), y, sx(w_.good) - sx(-w_.good), h);
    ctx.fillStyle = "#1b8a48"; ctx.fillRect(sx(-w_.perfect), y, sx(w_.perfect) - sx(-w_.perfect), h);
    ctx.fillStyle = "#17301c"; ctx.fillRect(sx(0) - 1, y - 3, 2, h + 6);
    var d = T.delta === 9999 ? 0 : T.delta, mk = sx(d);
    if (T.delta !== 9999) { ctx.fillStyle = "#17301c"; ctx.beginPath(); ctx.moveTo(mk, y - 4); ctx.lineTo(mk - 7, y - 14); ctx.lineTo(mk + 7, y - 14); ctx.fill(); }
    ctx.fillStyle = "#17301c"; ctx.font = "800 13px system-ui"; ctx.textAlign = "left"; ctx.fillText(T.text, x, y - 18); ctx.font = "700 10px system-ui"; ctx.fillStyle = "#5d7a60"; ctx.fillText("early", x, y + h + 11); ctx.textAlign = "right"; ctx.fillText("late", x + w, y + h + 11);
    ctx.restore();
  }
  function drawStumps(x, y, fall) {
    ctx.save(); ctx.translate(x, y);
    for (var i = -1; i <= 1; i++) { ctx.save(); ctx.translate(i * 8, 0); ctx.rotate(fall * i * 0.9 + fall * 0.15); ctx.translate(0, -fall * 8); ctx.fillStyle = "#f4e3b0"; ctx.fillRect(-2.5, -58, 5, 58); ctx.restore(); }
    ctx.fillStyle = "#f4e3b0"; if (!fall) { ctx.fillRect(-13, -61, 11, 4); ctx.fillRect(2, -61, 11, 4); } else { ctx.save(); ctx.translate(-12 - fall * 30, -60 - fall * 36); ctx.rotate(fall * 3); ctx.fillRect(-6, 0, 12, 4); ctx.restore(); }
    ctx.restore();
  }
  function drawBowler(now) {
    var x = 175, t = 1;
    if (G.phase === "set") { x = 44; t = 0; } else if (G.phase === "run") { t = clamp((now - G.runT0) / G.runDur, 0, 1); x = 44 + t * 131; }
    ctx.save(); ctx.translate(x, GY);
    var s = 1.4, step = G.phase === "run" ? Math.sin(t * 30) * 12 : 0;
    ctx.lineCap = "round"; ctx.strokeStyle = "#f4f4f4"; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(0, -38 * s); ctx.lineTo(-7 + step, 0); ctx.moveTo(0, -38 * s); ctx.lineTo(8 - step, 0); ctx.stroke();
    ctx.strokeStyle = "#2a6fdb"; ctx.lineWidth = 15; ctx.beginPath(); ctx.moveTo(0, -38 * s); ctx.lineTo(2, -68 * s); ctx.stroke();
    var arm = G.phase === "run" ? -2.4 + t * 5.2 : G.phase === "set" ? -1.6 : 0.9;
    var hx = Math.cos(arm) * 34, hy = -62 * s + Math.sin(arm) * 34;
    ctx.strokeStyle = "#f2c9a0"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(2, -62 * s); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = "#f2c9a0"; ctx.beginPath(); ctx.arc(3, -78 * s, 11, 0, 7); ctx.fill();
    ctx.fillStyle = "#c62828"; ctx.beginPath(); ctx.arc(3, -81 * s, 12, Math.PI, 0); ctx.fill(); ctx.fillRect(2, -81 * s, 17, 4);
    ctx.restore();
  }
  function drawBatter(now) {
    var b = batState(now), L = 86, sh = b.shift;
    var hip = { x: BX + 8 + sh * 0.2, y: GY - 56 }, sho = { x: BX - 2 + sh * 0.55, y: GY - 104 }, head = { x: BX - 8 + sh * 0.5, y: GY - 122 };
    var hand = { x: BX - 36 + sh, y: GY - 74 };
    var dir = { x: -Math.sin(b.th), y: Math.cos(b.th) };
    ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
    // back leg + pad
    var stride = b.p * 22;
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 15; ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(BX + 20 + sh * 0.1, GY - 4); ctx.stroke();
    ctx.strokeStyle = "#17301c"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(BX + 20 + sh * 0.1, GY - 4); ctx.lineTo(BX + 34 + sh * 0.1, GY); ctx.stroke();
    // front leg + pad (strides forward into the shot)
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 15; ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(BX - 20 - stride + sh * 0.3, GY - 4); ctx.stroke();
    ctx.strokeStyle = "#17301c"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(BX - 20 - stride + sh * 0.3, GY - 4); ctx.lineTo(BX - 36 - stride + sh * 0.3, GY); ctx.stroke();
    // torso
    ctx.strokeStyle = "#2a6fdb"; ctx.lineWidth = 24; ctx.beginPath(); ctx.moveTo(hip.x, hip.y - 4); ctx.lineTo(sho.x, sho.y + 6); ctx.stroke();
    // arms to the hands
    ctx.strokeStyle = "#2a6fdb"; ctx.lineWidth = 9; var el = { x: (sho.x + hand.x) / 2 - 6, y: (sho.y + hand.y) / 2 + 10 };
    ctx.beginPath(); ctx.moveTo(sho.x, sho.y + 4); ctx.lineTo(el.x, el.y); ctx.stroke(); ctx.strokeStyle = "#f2c9a0"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(el.x, el.y); ctx.lineTo(hand.x, hand.y); ctx.stroke();
    // bat: handle then blade, gripped at the hands
    var hEnd = { x: hand.x + dir.x * 26, y: hand.y + dir.y * 26 }, tip = { x: hand.x + dir.x * L, y: hand.y + dir.y * L };
    ctx.strokeStyle = "#7a4a1d"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(hand.x - dir.x * 8, hand.y - dir.y * 8); ctx.lineTo(hEnd.x, hEnd.y); ctx.stroke();
    ctx.strokeStyle = "#e6b868"; ctx.lineWidth = 17; ctx.beginPath(); ctx.moveTo(hEnd.x, hEnd.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.strokeStyle = "#f6d391"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(hEnd.x - dir.y * 3, hEnd.y + dir.x * 3); ctx.lineTo(tip.x - dir.y * 3, tip.y + dir.x * 3); ctx.stroke();
    ctx.fillStyle = "#f2c9a0"; ctx.beginPath(); ctx.arc(hand.x, hand.y, 7, 0, 7); ctx.fill();
    // head, helmet and grille
    ctx.fillStyle = "#f2c9a0"; ctx.beginPath(); ctx.arc(head.x, head.y, 12, 0, 7); ctx.fill();
    ctx.fillStyle = "#1b4fa8"; ctx.beginPath(); ctx.arc(head.x, head.y - 2, 14, Math.PI * 0.95, Math.PI * 2.05); ctx.fill(); ctx.fillRect(head.x - 14, head.y - 4, 28, 5);
    ctx.strokeStyle = "#0d2c66"; ctx.lineWidth = 2; for (var gx = -9; gx <= 3; gx += 6) { ctx.beginPath(); ctx.moveTo(head.x + gx - 4, head.y + 1); ctx.lineTo(head.x + gx - 7, head.y + 13); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(head.x - 16, head.y + 6); ctx.lineTo(head.x - 2, head.y + 7); ctx.stroke();
    ctx.restore();
  }
  function launchBall(now) {
    var L = G.launch, t = (now - L.t0) / 1000, k = L.kind, zoneDepth = (L.zone - 1) * 0.28;
    if (k === "six") { var tt = t < 0.45 ? t * 0.55 : 0.2475 + (t - 0.45); return { x: L.x - 360 * tt, y: L.y - 640 * tt + 340 * tt * tt, r: Math.max(3, 12 - tt * 8), h: 0 }; }
    if (k === "caught") return { x: L.x - 250 * t, y: L.y - 520 * t + 640 * t * t * 0.5 * 1, r: Math.max(5, 12 - t * 4), h: 0 };
    if (k === "four" || k === "dropped") { var yy = GY - 8 - Math.abs(Math.sin(t * 9)) * 18 * Math.max(0, 1 - t * 0.9) + zoneDepth * t * 40; return { x: L.x - 620 * t, y: yy, r: Math.max(5, 12 - t * 3), h: 0 }; }
    if (k === "run") { var edge = L.q === "edge"; var yb = GY - 8 - Math.abs(Math.sin(t * 7)) * 10; return { x: L.x + (edge ? 170 : -240) * t, y: yb, r: 10, h: 0 }; }
    return { x: L.x, y: L.y, r: 0, h: 0 };
  }

  // ---------- drawing: field map ----------
  var FC = { x: 180, y: 190 }, ANG = [-150, -90, -30];
  function zonePos(z, type) { var a = ANG[z] * Math.PI / 180, r = type === "deep" ? 128 : 78; return { x: FC.x + Math.cos(a) * r, y: FC.y + Math.sin(a) * r }; }
  function drawField(now) {
    if (!G || !G.field) return; now = now || performance.now();
    var c = fx, S = 360;
    c.clearRect(0, 0, S, S); c.fillStyle = "#3f9b4a"; c.fillRect(0, 0, S, S);
    for (var z = 0; z < 3; z++) {
      var a0 = (ANG[z] - 28) * Math.PI / 180, a1 = (ANG[z] + 28) * Math.PI / 180;
      c.beginPath(); c.moveTo(FC.x, FC.y); c.arc(FC.x, FC.y, 160, a0, a1); c.closePath();
      c.fillStyle = G.stance === z ? "rgba(255,183,3,.5)" : "rgba(255,255,255,.06)"; c.fill(); c.strokeStyle = "rgba(255,255,255,.35)"; c.lineWidth = 1.5; c.stroke();
    }
    c.strokeStyle = "#fff"; c.lineWidth = 3; c.setLineDash([2, 6]); c.beginPath(); c.arc(FC.x, FC.y, 160, 0, 7); c.stroke(); c.setLineDash([]);
    c.strokeStyle = "rgba(255,255,255,.4)"; c.lineWidth = 1; c.beginPath(); c.arc(FC.x, FC.y, 100, 0, 7); c.stroke();
    c.fillStyle = "#d6b583"; c.fillRect(FC.x - 9, FC.y - 70, 18, 100);
    c.fillStyle = "#17301c"; c.beginPath(); c.arc(FC.x, FC.y + 22, 8, 0, 7); c.fill(); c.fillStyle = "#fff"; c.beginPath(); c.arc(FC.x, FC.y + 22, 4, 0, 7); c.fill();
    c.font = "800 12px system-ui"; c.textAlign = "center";
    G.field.forEach(function (f, z) {
      var lp = [{ x: 62, y: 44 }, { x: 180, y: 22 }, { x: 298, y: 44 }][z];
      if (f.type !== "none") {
        var p = zonePos(z, f.type);
        c.fillStyle = "#ffffff"; c.beginPath(); c.arc(p.x, p.y, 12, 0, 7); c.fill(); c.strokeStyle = "#17301c"; c.lineWidth = 2.5; c.stroke();
        c.fillStyle = f.type === "deep" ? "#c62828" : "#2a6fdb"; c.beginPath(); c.arc(p.x, p.y - 2, 5.5, 0, 7); c.fill();
        c.fillStyle = "#fff"; c.strokeStyle = "rgba(0,0,0,.7)"; c.lineWidth = 3; c.strokeText(f.name, p.x, p.y + 26); c.fillText(f.name, p.x, p.y + 26);
      } else { c.fillStyle = "#fff"; c.strokeStyle = "rgba(0,0,0,.6)"; c.lineWidth = 3; var gp = { x: FC.x + Math.cos(ANG[z] * Math.PI / 180) * 105, y: FC.y + Math.sin(ANG[z] * Math.PI / 180) * 105 + 4 }; c.font = "900 15px system-ui"; c.strokeText("GAP", gp.x, gp.y); c.fillText("GAP", gp.x, gp.y); c.font = "800 12px system-ui"; }
      c.fillStyle = G.stance === z ? "#ffb703" : "rgba(255,255,255,.95)"; c.strokeStyle = "rgba(0,0,0,.6)"; c.lineWidth = 3; c.strokeText(ZN[z], lp.x, lp.y); c.fillText(ZN[z], lp.x, lp.y);
    });
    c.fillStyle = "rgba(255,255,255,.9)"; c.font = "700 10px system-ui"; c.fillText("batter", FC.x, FC.y + 44);
    if (G.fa) {
      var o = G.fa.o, t = (now - G.fa.t0) / 700, k = Math.min(1, t), tgt;
      if (o.q === "miss") tgt = { x: FC.x, y: FC.y + 22 };
      else if (o.kind === "six") tgt = { x: FC.x + Math.cos(ANG[o.zone] * Math.PI / 180) * 185, y: FC.y + Math.sin(ANG[o.zone] * Math.PI / 180) * 185 };
      else if (o.kind === "four" || o.kind === "dropped") tgt = { x: FC.x + Math.cos(ANG[o.zone] * Math.PI / 180) * 158, y: FC.y + Math.sin(ANG[o.zone] * Math.PI / 180) * 158 };
      else if (o.kind === "caught") tgt = zonePos(o.zone, o.f.type);
      else if (o.kind === "run") tgt = zonePos(o.zone, o.f && o.f.type === "deep" ? "deep" : "close");
      else tgt = { x: FC.x, y: FC.y + 12 };
      var bx = FC.x + (tgt.x - FC.x) * k, by = FC.y + 22 + (tgt.y - FC.y - 22) * k;
      c.strokeStyle = "rgba(255,255,255,.6)"; c.lineWidth = 2; c.beginPath(); c.moveTo(FC.x, FC.y + 22); c.lineTo(bx, by); c.stroke();
      c.fillStyle = "#c62828"; c.beginPath(); c.arc(bx, by, 6 + (o.kind === "six" ? Math.sin(k * Math.PI) * 4 : 0), 0, 7); c.fill();
      if (k >= 1 && o.kind === "caught") { c.fillStyle = "#c62828"; c.strokeStyle = "#fff"; c.lineWidth = 4; c.font = "900 22px system-ui"; c.strokeText("OUT!", tgt.x, tgt.y - 18); c.fillText("OUT!", tgt.x, tgt.y - 18); }
      if (k >= 1 && o.kind === "dropped") { c.fillStyle = "#ffb703"; c.strokeStyle = "#17301c"; c.lineWidth = 4; c.font = "900 18px system-ui"; c.strokeText("DROPPED!", tgt.x, tgt.y - 18); c.fillText("DROPPED!", tgt.x, tgt.y - 18); }
    }
  }
  fd.addEventListener("pointerdown", function (e) {
    var r = fd.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 360 - FC.x, y = (e.clientY - r.top) / r.height * 360 - FC.y;
    var a = Math.atan2(y, x) * 180 / Math.PI, best = 1, bd = 999;
    ANG.forEach(function (an, i) { var d = Math.abs(((a - an + 540) % 360) - 180); if (d < bd) { bd = d; best = i; } });
    if (y < 10) setStance(best);
  });

  // ---------- match end ----------
  function endMatch(win) {
    cancelAnimationFrame(raf); raf = 0;
    var left = 6 - G.balls, stars = win ? (left >= 3 ? 3 : left >= 1 ? 2 : 1) : 0;
    R.stars += stars; R.runs += G.runs; R.sixes += G.six; R.fours += G.four; R.results.push({ win: win, runs: G.runs, stars: stars });
    var rng = mulberry(hash(R.code + "e" + R.match));
    $("rIcon").textContent = win ? "🏆" : "😬";
    $("rTitle").textContent = win ? pick(rng, ["Target chased! Cue the crowd!", "Home with balls to spare!", "The captain is crying (happily)!"]) : pick(rng, ["So close, yet so far...", "The over ends and the dream with it.", "Out of time, out of wickets."]);
    $("rText").textContent = win ? "You got " + G.runs + " and needed " + G.target + (left ? ", with " + left + " ball" + (left === 1 ? "" : "s") + " to spare." : ", off the very last ball.") : "You made " + G.runs + ", the target was " + G.target + ". The auntie in the front row has some advice.";
    $("rScore").textContent = G.runs + "/" + G.wk; $("rBound").textContent = G.six + " / " + G.four; $("rStars").textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
    $("rCode").textContent = "";
    var last = R.match >= 2;
    $("rNext").textContent = last ? "See my run" : "Next match"; $("rNext").dataset.mode = last ? "end" : "next";
    show("sResult"); if (win) cheer(); else groan();
  }
  $("rNext").addEventListener("click", function () {
    if (this.dataset.mode === "end") { finishRun(); return; }
    if (this.dataset.mode === "again") { newRun(null, false); return; }
    R.match++; intro();
  });
  function finishRun() {
    var rank = RANKS.filter(function (r) { return R.stars >= r[0]; }).pop();
    var best = store("so-best") || 0; if (R.stars > best) store("so-best", R.stars);
    $("rIcon").textContent = "🏏"; $("rTitle").textContent = pick(mulberry(hash(R.code)), rank[1]);
    $("rText").textContent = R.results.map(function (x, i) { return "Match " + (i + 1) + ": " + (x.win ? "won" : "lost") + " (" + x.runs + ")"; }).join("  ·  ");
    $("rScore").textContent = R.runs + " runs"; $("rBound").textContent = R.sixes + " / " + R.fours; $("rStars").textContent = R.stars + "/9";
    $("rCode").innerHTML = 'Run code: <span class="code">' + R.code + '</span> (share it, and your friend faces the same bowlers and fielders)';
    $("rNext").textContent = "New run"; $("rNext").dataset.mode = "again";
  }

  // ---------- wiring ----------
  $("goRandom").addEventListener("click", function () { newRun(null, false); });
  $("goDaily").addEventListener("click", function () { newRun(null, true); });
  $("codeGo").addEventListener("click", function () {
    var m = /^\s*SO-([0-9A-Za-z]{1,4})\s*$/.exec($("codeIn").value);
    if (!m) { $("codeMsg").textContent = "That code does not look right. It should look like SO-1A2B."; return; }
    $("codeMsg").textContent = ""; newRun(m[1].toLowerCase(), false);
  });
  Array.prototype.forEach.call(sr.querySelectorAll("[data-diff]"), function (b) { b.addEventListener("click", function () { setDiff(b.dataset.diff); }); });
  $("goPlay").addEventListener("click", beginMatch);
  $("bowlNow").addEventListener("click", function () { if (G && G.phase === "set") G.setT0 = performance.now() - G.setDur; });
  $("rMenu").addEventListener("click", function () { cancelAnimationFrame(raf); show("sTitle"); });
  $("navSound").addEventListener("click", function () { soundOn = !soundOn; this.textContent = soundOn ? "Sound on" : "Sound off"; this.setAttribute("aria-pressed", String(soundOn)); });
  $("swing").addEventListener("pointerdown", function (e) { e.preventDefault(); swing(); });
  cv.addEventListener("pointerdown", function (e) { e.preventDefault(); swing(); });
  Array.prototype.forEach.call($("stance").children, function (b) { b.addEventListener("click", function () { setStance(+b.dataset.z); }); });
  function onKey(e) {
    var k = e.key, inField = ((e.composedPath && e.composedPath()[0]) || {}).tagName === "INPUT";
    if (k === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (inField || $("sGame").hidden) return;
    var used = true;
    if (k === " " || k === "Enter") swing();
    else if (k === "a" || k === "A" || k === "ArrowLeft") setStance(0);
    else if (k === "s" || k === "S" || k === "ArrowUp") setStance(1);
    else if (k === "d" || k === "D" || k === "ArrowRight") setStance(2);
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
  // A ball that was in the air while the tab was hidden is bowled again, not lost.
  function onVisible() {
    if (document.hidden || !G) return;
    if (G.phase === "run" || G.phase === "flight") { lastNow = 0; setupBall(); say(COMM[0], "Tab switch! The ball is bowled again."); }
  }

  var open_ = false;
  function open() {
    if (open_) return Promise.resolve();
    open_ = true;
    var ready;
    try { ready = chrome.storage.local.get("sxrts_game").then(function (r) { prefs = (r && r.sxrts_game) || {}; }, function () { prefs = {}; }); } catch (e) { ready = Promise.resolve(); }
    return ready.then(function () {
      diffKey = DIFF[prefs["so-diff"]] ? prefs["so-diff"] : "easy";
      setDiff(diffKey);
      R = null; G = null; show("sTitle");
      host.hidden = false;
      window.addEventListener("keydown", onKey, true);
      document.addEventListener("visibilitychange", onVisible);
      modal.focus({ preventScroll: true });
    });
  }
  function close() {
    if (!open_) return;
    open_ = false;
    cancelAnimationFrame(raf); raf = 0; G = null; R = null; lastNow = 0;
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("visibilitychange", onVisible);
    host.hidden = true;
  }
  $("closeGame").addEventListener("click", close);
  return { open: open, close: close, debug: { get G() { return G; }, get R() { return R; }, swing: swing, setStance: setStance, judge: judge, windows: windows, LEAD: LEAD, DIFF: DIFF, isOpen: function () { return open_; } } };
  }

  globalThis.SXRTS = globalThis.SXRTS || {};
  globalThis.SXRTS.gameUi = { mount(panelShadow) { const api = mount(panelShadow); globalThis.SXRTS.gameUi.instance = api; return api; } };
})();
