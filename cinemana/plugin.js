(function () {
  const API = (manifest.baseUrl || "https://cinemana.shabakaty.cc").replace(/\/$/, "") + "/api/android";
  const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
  function text(v) { return v == null ? "" : String(v); }
  function first(o, keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      var v = o && o[keys[i]];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return fallback;
  }
  function listOf(d) {
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.data)) return d.data;
    if (d && Array.isArray(d.result)) return d.result;
    if (d && Array.isArray(d.results)) return d.results;
    if (d && Array.isArray(d.content)) return d.content;
    return [];
  }
  async function get(path) {
    var r = await fetch(API + path, { headers: { "Accept": "application/json, text/plain, */*", "User-Agent": UA } });
    if (!r.ok) throw new Error("Cinemana API HTTP " + r.status + " at " + path);
    var body = await r.text();
    try { return JSON.parse(body); } catch (_) { throw new Error("Cinemana returned invalid JSON for " + path); }
  }
  function itemTitle(i) { return text(first(i, ["en_title", "ar_title", "title", "name"], "Cinemana item")); }
  function itemKind(i) {
    var k = text(first(i, ["kind", "videoKind", "type"], "1")).toLowerCase();
    return k === "2" || k === "series" || k === "tv" || k === "tvseries" ? "series" : "movie";
  }
  function toItem(i) {
    var id = text(first(i, ["nb", "id", "videoId"], ""));
    var kind = itemKind(i);
    var year = parseInt(first(i, ["year", "releaseYear"], ""), 10);
    var score = parseFloat(first(i, ["stars", "rating", "score"], 0)) || 0;
    return new MultimediaItem({
      title: itemTitle(i), url: "cinemana:" + kind + ":" + id, type: kind,
      description: text(first(i, ["en_content", "ar_content", "description", "plot"], "")),
      posterUrl: text(first(i, ["imgThumbObjUrl", "imgObjUrl", "poster", "posterUrl"], "")),
      score: score, year: isFinite(year) ? year : undefined
    });
  }
  function parseUrl(url) {
    var p = text(url).split(":");
    if (p[0] !== "cinemana" || !p[2]) return null;
    return { kind: p[1] === "series" ? "series" : "movie", id: p.slice(2).join(":") };
  }
  function toEpisode(ep, index) {
    var id = text(first(ep, ["nb", "id", "videoId"], ""));
    var season = parseInt(first(ep, ["season", "seasonNumber"], 1), 10) || 1;
    var number = parseInt(first(ep, ["episodeNummer", "episode", "episodeNumber"], index + 1), 10) || index + 1;
    var name = text(first(ep, ["en_title", "ar_title", "title", "name"], "Episode " + number));
    return new Episode({
      name: "S" + String(season).padStart(2, "0") + "E" + String(number).padStart(2, "0") + " — " + name,
      url: "cinemana:episode:" + id, season: season, episode: number,
      description: text(first(ep, ["en_content", "ar_content", "description"], "")),
      posterUrl: text(first(ep, ["imgThumbObjUrl", "imgObjUrl"], "")), dubStatus: "none"
    });
  }
  async function getHome(cb) {
    try {
      var routes = [
        "/video/V/2?videoKind=1&langNb=&itemsPerPage=30&pageNumber=1&level=0&sortParam=desc",
        "/video/V/2?videoKind=2&langNb=&itemsPerPage=30&pageNumber=1&level=0&sortParam=desc"
      ];
      var results = await Promise.all(routes.map(get));
      cb({ success: true, data: {
        "أفلام سينمانا": listOf(results[0]).map(toItem),
        "مسلسلات سينمانا": listOf(results[1]).map(toItem)
      }});
    } catch (e) { cb({ success: false, errorCode: "HOME_ERROR", message: text(e && e.message || e) }); }
  }
  async function search(query, page, cb) {
    if (typeof page === "function") { cb = page; page = 1; }
    try {
      var q = "videoTitle=" + encodeURIComponent(text(query)) + "&itemsPerPage=30&page=" + (parseInt(page, 10) || 1);
      var results = await Promise.all([
        get("/AdvancedSearch?level=0&" + q + "&type=movies").catch(function () { return []; }),
        get("/AdvancedSearch?level=0&" + q + "&type=series").catch(function () { return []; })
      ]);
      var items = listOf(results[0]).concat(listOf(results[1])).map(toItem);
      var seen = {};
      items = items.filter(function (item) { if (seen[item.url]) return false; seen[item.url] = true; return true; });
      cb({ success: true, data: items });
    } catch (e) { cb({ success: false, errorCode: "SEARCH_ERROR", message: text(e && e.message || e) }); }
  }
  async function load(url, cb) {
    var p = parseUrl(url);
    if (!p) { cb({ success: false, errorCode: "BAD_URL", message: "Invalid Cinemana item URL" }); return; }
    try {
      var info = await get("/allVideoInfo/id/" + encodeURIComponent(p.id));
      var d = info && info.data ? info.data : info;
      var episodes = [];
      if (p.kind === "series") {
        var seasons = await get("/videoSeason/id/" + encodeURIComponent(p.id));
        episodes = listOf(seasons).map(toEpisode);
      }
      var year = parseInt(first(d, ["year"], ""), 10);
      cb({ success: true, data: new MultimediaItem({
        title: itemTitle(d || {}), url: url, type: p.kind,
        description: text(first(d, ["en_content", "ar_content", "description", "plot"], "")),
        posterUrl: text(first(d, ["imgObjUrl", "imgThumbObjUrl"], "")),
        score: parseFloat(first(d, ["stars", "rating"], 0)) || 0,
        year: isFinite(year) ? year : undefined, episodes: episodes
      })});
    } catch (e) { cb({ success: false, errorCode: "LOAD_ERROR", message: text(e && e.message || e) }); }
  }
  async function loadStreams(url, cb) {
    var p = text(url).split(":");
    var id = p[0] === "cinemana" && p[1] === "episode" ? p.slice(2).join(":") : (parseUrl(url) || {}).id;
    if (!id) { cb({ success: false, errorCode: "BAD_URL", message: "Invalid Cinemana video ID" }); return; }
    try {
      var data = await get("/transcoddedFiles/id/" + encodeURIComponent(id));
      var streams = listOf(data).map(function (v) {
        var u = text(first(v, ["videoUrl", "url", "file"], "")).replace(/\\/g, "");
        var q = text(first(v, ["resolution", "name", "quality"], "Auto"));
        return u ? new StreamResult({ url: u, quality: q }) : null;
      }).filter(Boolean);
      if (!streams.length) cb({ success: false, errorCode: "NO_STREAMS", message: "No playable qualities returned by Cinemana for this item" });
      else cb({ success: true, data: streams });
    } catch (e) { cb({ success: false, errorCode: "STREAMS_ERROR", message: text(e && e.message || e) }); }
  }
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;
})();