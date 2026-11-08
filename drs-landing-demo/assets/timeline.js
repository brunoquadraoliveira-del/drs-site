(() => {
  const records = Array.isArray(window.DRS_TIMELINE) ? window.DRS_TIMELINE : [];
  const labels = {
    inventory: "Inventário florestal",
    cubage: "Cubagem florestal",
    quality: "Qualidade de plantios",
    operations: "Operações e silvicultura",
    mapping: "Aerolevantamento e mapeamento",
    licensing: "Licenciamento e árvores de risco",
    recovery: "PRAD e recuperação ambiental",
    native: "Vegetação nativa e estudos",
    expertise: "Perícia florestal",
    other: "Atividade florestal",
    milestone: "Marco da empresa"
  };
  const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const fullMonths = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const southStates = new Set(["SC", "PR", "RS"]);
  const stateCodes = { "11":"RO", "12":"AC", "13":"AM", "14":"RR", "15":"PA", "16":"AP", "17":"TO", "21":"MA", "22":"PI", "23":"CE", "24":"RN", "25":"PB", "26":"PE", "27":"AL", "28":"SE", "29":"BA", "31":"MG", "32":"ES", "33":"RJ", "35":"SP", "41":"PR", "42":"SC", "43":"RS", "50":"MS", "51":"MT", "52":"GO", "53":"DF" };
  const allPosts = records.filter(record => record.sourceType === "publicação do Instagram");
  const years = [...new Set(records.map(record => record.year))].sort((a, b) => a - b);
  const pageSize = 12;
  const state = { year: "all", month: "all", service: "all", query: "", city: "", shown: pageSize, playing: false, playTimer: null };
  const $ = selector => document.querySelector(selector);
  const yearControls = $("#year-controls");
  const monthControls = $("#month-controls");
  const cardList = $("#timeline-cards");
  const dialog = $("#record-dialog");
  const dialogContent = $("#dialog-content");
  let map;
  let heatGroup;
  let pointGroup;
  let stateLayer;
  let municipalityGroup;
  let mapBaseWarning;
  const mapWarnings = new Map();
  let citySummary = [];
  let mapStateCounts = {};
  const municipalityLayers = new Map();
  const municipalityRequests = new Map();
  let dialogRecord;
  let dialogImageIndex = 0;

  const monthDate = record => record.date || `${record.year}-01`;
  const formatMonth = value => {
    const [year, month] = value.split("-").map(Number);
    return `${fullMonths[(month || 1) - 1]} de ${year}`;
  };
  const dateText = record => {
    if (record.displayDate) return record.displayDate;
    if (record.exactDate) {
      const [year, month, day] = record.exactDate.split("-").map(Number);
      return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
    }
    if (record.dateEnd) return `${months[(Number(record.date.slice(5, 7)) || 1) - 1]}–${months[(Number(record.dateEnd.slice(5, 7)) || 1) - 1]} ${record.year}`;
    return `${months[(Number(record.date.slice(5, 7)) || 1) - 1]} ${record.year}`;
  };
  const recordMatchesMonth = (record, monthKey) => {
    const start = monthDate(record);
    return start === monthKey || (record.dateEnd && monthKey >= start && monthKey <= record.dateEnd);
  };
  const visibleRecords = () => records.filter(record => {
    if (state.year !== "all" && Number(record.year) !== Number(state.year)) return false;
    if (state.month !== "all" && !recordMatchesMonth(record, `${state.year}-${String(state.month).padStart(2, "0")}`)) return false;
    if (state.service !== "all" && !record.categories.includes(state.service)) return false;
    if (state.city && !record.places.some(place => `${place.city}|${place.state}` === state.city)) return false;
    if (state.query) {
      const text = [record.id, record.locationLabel, record.service, record.species.join(" "), record.area || ""].join(" ").toLocaleLowerCase("pt-BR");
      if (!text.includes(state.query)) return false;
    }
    return true;
  });
  const normalizeRecordOrder = list => list.slice().sort((a, b) => monthDate(a).localeCompare(monthDate(b)) || a.id.localeCompare(b.id));
  const cityKey = place => `${place.city}|${place.state}`;
  const getCitySummary = list => {
    const cities = new Map();
    list.forEach(record => record.places.forEach(place => {
      if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return;
      const key = cityKey(place);
      const current = cities.get(key) || { ...place, key, count: 0 };
      current.count += 1;
      cities.set(key, current);
    }));
    return [...cities.values()].sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "pt-BR"));
  };

  function buildServiceFilter() {
    const select = $("#service-filter");
    Object.entries(labels).forEach(([key, label]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = label;
      select.append(option);
    });
  }

  function buildYearControls() {
    const counts = new Map(years.map(year => [year, records.filter(record => record.year === year).length]));
    const max = Math.max(1, ...counts.values());
    const addYear = (value, label, count) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tl-year";
      button.dataset.year = value;
      button.setAttribute("aria-pressed", String(state.year === value));
      const name = document.createElement("span");
      name.textContent = label;
      const number = document.createElement("span");
      number.className = "tl-year-count";
      number.textContent = count === null ? "Explorar tudo" : `${count} registros`;
      const track = document.createElement("span");
      track.className = "tl-year-track";
      track.style.width = count === null ? "100%" : `${Math.max(5, count / max * 100)}%`;
      button.append(name, number, track);
      button.addEventListener("click", () => {
        stopPlayback();
        state.year = value;
        state.month = "all";
        state.shown = pageSize;
        renderAll();
      });
      yearControls.append(button);
    };
    addYear("all", "Todos", null);
    years.forEach(year => addYear(String(year), String(year), counts.get(year)));
  }

  function renderMonthControls() {
    monthControls.replaceChildren();
    monthControls.classList.toggle("is-visible", state.year !== "all");
    if (state.year === "all") return;
    const yearRecords = records.filter(record => record.year === Number(state.year));
    const counts = Array(12).fill(0);
    yearRecords.forEach(record => {
      const start = Number(record.date.slice(5, 7)) || 1;
      const end = record.dateEnd ? Number(record.dateEnd.slice(5, 7)) : start;
      for (let month = start; month <= end; month += 1) counts[month - 1] += 1;
    });
    const max = Math.max(1, ...counts);
    const addMonth = (value, label, count) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tl-month";
      button.setAttribute("aria-pressed", String(state.month === value));
      button.style.setProperty("--bar", `${count ? 5 + count / max * 17 : 2}px`);
      const caption = document.createElement("span");
      caption.textContent = label;
      const title = count === 1 ? "1 registro" : `${count} registros`;
      button.title = `${label} · ${title}`;
      button.append(caption);
      button.addEventListener("click", () => {
        state.month = value;
        state.shown = pageSize;
        renderAll();
      });
      monthControls.append(button);
    };
    addMonth("all", "Todos", yearRecords.length);
    counts.forEach((count, index) => {
      if (count > 0) addMonth(String(index + 1), months[index], count);
    });
  }

  function createMap() {
    const mapElement = $("#drs-map");
    if (!window.L) {
      mapElement.textContent = "O mapa não carregou. Os registros e os filtros continuam disponíveis abaixo.";
      mapElement.style.display = "grid";
      mapElement.style.placeItems = "center";
      mapElement.style.padding = "24px";
      mapElement.style.color = "#52645c";
      return;
    }
    map = L.map(mapElement, { scrollWheelZoom: false, zoomControl: true, minZoom: 3, maxZoom: 15, preferCanvas: true });
    mapBaseWarning = $("#map-base-warning");
    map.createPane("drsStates");
    map.getPane("drsStates").style.zIndex = 400;
    map.createPane("drsMunicipalities");
    map.getPane("drsMunicipalities").style.zIndex = 410;
    map.createPane("drsHeat");
    map.getPane("drsHeat").style.zIndex = 420;
    map.createPane("drsPoints");
    map.getPane("drsPoints").style.zIndex = 430;
    municipalityGroup = L.layerGroup().addTo(map);
    heatGroup = L.layerGroup().addTo(map);
    pointGroup = L.layerGroup().addTo(map);
    const mapKey = window.DRS_MAP_CONFIG?.mapTilerKey?.trim();
    if (mapKey) {
      let tileErrors = 0;
      const tileLayer = L.tileLayer(`https://api.maptiler.com/maps/streets-v4/{z}/{x}/{y}.png?key=${encodeURIComponent(mapKey)}`, {
        tileSize: 512,
        zoomOffset: -1,
        minZoom: 1,
        maxZoom: 20,
        crossOrigin: true,
        attribution: '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>'
      });
      tileLayer.on("tileerror", () => {
        tileErrors += 1;
        if (tileErrors >= 3) showMapWarning("tiles", "O fundo cartográfico não carregou. As divisas do IBGE e os pontos dos registros continuam disponíveis.");
      });
      tileLayer.on("tileload", () => {
        tileErrors = Math.max(0, tileErrors - 1);
        if (tileErrors < 3) clearMapWarning("tiles");
      });
      tileLayer.addTo(map);
    } else {
      showMapWarning("key", "O fundo cartográfico precisa da chave MapTiler autorizada para este domínio. As divisas do IBGE e os pontos dos registros continuam disponíveis.");
    }
    map.fitBounds([[-34.0, -74.0], [6.0, -34.0]], { padding: [18, 18] });
    const meshUrl = "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?intrarregiao=UF&formato=application%2Fvnd.geo%2Bjson&qualidade=minima";
    fetch(meshUrl, { headers: { Accept: "application/vnd.geo+json" }, mode: "cors", cache: "force-cache" })
      .then(response => { if (!response.ok) throw new Error(`IBGE ${response.status}`); return response.json(); })
      .then(geojson => {
        stateLayer = L.geoJSON(geojson, {
          pane: "drsStates",
          style: feature => stateStyle(feature, mapStateCounts),
          onEachFeature: (feature, layer) => {
            const uf = featureUf(feature);
            const name = stateNames[uf] || uf || "Estado";
            layer.bindTooltip(name, { sticky: true, className: "tl-state-tooltip" });
            layer.on({
              mouseover: event => event.target.setStyle({ weight: 2, color: "#174f3b", fillOpacity: .28 }),
              mouseout: event => event.target.setStyle(stateStyle(event.target.feature, mapStateCounts)),
              click: event => map.fitBounds(event.target.getBounds(), { padding: [20, 20], maxZoom: 7 })
            });
          }
        }).addTo(map);
        map.fitBounds(stateLayer.getBounds(), { padding: [18, 18] });
        drawMap(visibleRecords());
        map.on("zoomend moveend", syncMunicipalLayers);
      })
      .catch(() => {
        showMapWarning("states", "A malha estadual do IBGE não carregou. Os pontos dos registros e os filtros continuam disponíveis.");
        drawMap(visibleRecords());
      });
    $("#view-brazil").addEventListener("click", () => {
      if (stateLayer) map.fitBounds(stateLayer.getBounds(), { padding: [18, 18] });
      else map.fitBounds([[-34.0, -74.0], [6.0, -34.0]], { padding: [18, 18] });
    });
    $("#focus-hotspots").addEventListener("click", focusHotspots);
  }

  function showMapWarning(key, message) {
    if (!mapBaseWarning) return;
    mapWarnings.set(key, message);
    mapBaseWarning.hidden = false;
    mapBaseWarning.textContent = [...mapWarnings.values()].join(" ");
  }

  function clearMapWarning(key) {
    if (!mapBaseWarning) return;
    mapWarnings.delete(key);
    mapBaseWarning.hidden = mapWarnings.size === 0;
    mapBaseWarning.textContent = [...mapWarnings.values()].join(" ");
  }

  function syncMunicipalLayers() {
    if (!map || !stateLayer || !municipalityGroup) return;
    const visibleUfs = new Set();
    if (map.getZoom() >= 5) {
      const bounds = map.getBounds();
      stateLayer.eachLayer(layer => {
        if (bounds.intersects(layer.getBounds())) visibleUfs.add(featureUf(layer.feature));
      });
    }
    municipalityLayers.forEach((layer, uf) => {
      if (visibleUfs.has(uf)) municipalityGroup.addLayer(layer);
      else municipalityGroup.removeLayer(layer);
    });
    visibleUfs.forEach(loadMunicipalities);
  }

  function loadMunicipalities(uf) {
    if (!uf || municipalityLayers.has(uf) || municipalityRequests.has(uf)) return;
    const stateCode = Object.entries(stateCodes).find(([, code]) => code === uf)?.[0];
    if (!stateCode) return;
    const meshUrl = `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${stateCode}?intrarregiao=municipio&formato=application%2Fvnd.geo%2Bjson&qualidade=minima`;
    const namesUrl = `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${stateCode}/municipios`;
    const request = Promise.all([
      fetch(meshUrl, { headers: { Accept: "application/vnd.geo+json" }, mode: "cors", cache: "force-cache" }),
      fetch(namesUrl, { headers: { Accept: "application/json" }, mode: "cors", cache: "force-cache" })
    ]).then(async ([meshResponse, namesResponse]) => {
      if (!meshResponse.ok || !namesResponse.ok) throw new Error(`IBGE ${uf}`);
      const [geojson, municipalities] = await Promise.all([meshResponse.json(), namesResponse.json()]);
      const namesByCode = new Map(municipalities.map(municipality => [String(municipality.id), municipality.nome]));
      geojson.features.forEach(feature => {
        const code = String(feature.properties?.codarea ?? feature.id ?? "");
        feature.properties = { ...feature.properties, municipalityName: namesByCode.get(code) || code, uf };
      });
      const layer = L.geoJSON(geojson, {
        pane: "drsMunicipalities",
        style: municipalityStyle,
        onEachFeature: (feature, featureLayer) => {
          const place = findMappedCity(feature.properties?.municipalityName, uf);
          featureLayer.bindTooltip(municipalityTooltip(feature.properties?.municipalityName, uf, place), {
            sticky: true,
            direction: "top",
            className: "tl-municipality-tooltip"
          });
          featureLayer.on("click", () => {
            const currentPlace = findMappedCity(feature.properties?.municipalityName, uf);
            if (currentPlace) chooseCity(currentPlace.key, true);
          });
        }
      });
      municipalityLayers.set(uf, layer);
      syncMunicipalLayers();
      updateMunicipalityStyles();
    }).catch(() => {
      showMapWarning("municipalities", "Algumas divisas municipais não carregaram. O mapa estadual e os pontos dos registros continuam disponíveis.");
    }).finally(() => municipalityRequests.delete(uf));
    municipalityRequests.set(uf, request);
  }

  function normalizePlaceName(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
  }

  function findMappedCity(name, uf) {
    const normalized = normalizePlaceName(name);
    return citySummary.find(place => place.state === uf && normalizePlaceName(place.city) === normalized);
  }

  function municipalityTooltip(name, uf, place) {
    const label = `${name || "Município"}, ${uf}`;
    if (!place) return `${label} · sem registros DRS neste recorte`;
    return `${label} · ${place.count} registro(s) DRS`;
  }

  function municipalityStyle(feature) {
    const place = findMappedCity(feature.properties?.municipalityName, feature.properties?.uf);
    return {
      color: place ? "#dc594b" : "#71887b",
      weight: place ? 1.45 : .7,
      opacity: place ? .94 : .5,
      fillColor: place ? "#e96752" : "#fff",
      fillOpacity: place ? .14 : .025
    };
  }

  function updateMunicipalityStyles() {
    municipalityLayers.forEach(layer => layer.eachLayer(featureLayer => {
      featureLayer.setStyle(municipalityStyle(featureLayer.feature));
      const { municipalityName, uf } = featureLayer.feature.properties || {};
      featureLayer.setTooltipContent(municipalityTooltip(municipalityName, uf, findMappedCity(municipalityName, uf)));
    }));
  }

  const stateNames = { AC:"Acre", AL:"Alagoas", AP:"Amapá", AM:"Amazonas", BA:"Bahia", CE:"Ceará", DF:"Distrito Federal", ES:"Espírito Santo", GO:"Goiás", MA:"Maranhão", MT:"Mato Grosso", MS:"Mato Grosso do Sul", MG:"Minas Gerais", PA:"Pará", PB:"Paraíba", PR:"Paraná", PE:"Pernambuco", PI:"Piauí", RJ:"Rio de Janeiro", RN:"Rio Grande do Norte", RS:"Rio Grande do Sul", RO:"Rondônia", RR:"Roraima", SC:"Santa Catarina", SP:"São Paulo", SE:"Sergipe", TO:"Tocantins" };
  const featureUf = feature => {
    const props = feature?.properties || {};
    const code = String(props.codarea ?? props.CD_UF ?? feature?.id ?? "").padStart(2, "0");
    return props.sigla || stateCodes[code] || "";
  };
  function stateStyle(feature, counts) {
    const uf = featureUf(feature);
    const value = counts[uf] || 0;
    const max = Math.max(1, ...Object.values(counts));
    const ratio = value / max;
    const fillColor = !value ? "#dce8df" : ratio > .7 ? "#e86550" : ratio > .35 ? "#f1b65e" : "#69c779";
    return { color: "#587464", weight: 1, opacity: .82, fillColor, fillOpacity: value ? .2 : .08 };
  }
  function focusHotspots() {
    if (!map) return;
    if (!stateLayer) {
      const bounds = L.latLngBounds([]);
      citySummary.slice().sort((a, b) => b.count - a.count).slice(0, 10)
        .forEach(place => bounds.extend([place.lat, place.lon]));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 7 });
      return;
    }
    const stateCounts = getStateCounts(visibleRecords());
    const hotUfs = new Set(Object.entries(stateCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([uf]) => uf));
    const bounds = L.latLngBounds([]);
    stateLayer.eachLayer(layer => { if (hotUfs.has(featureUf(layer.feature))) bounds.extend(layer.getBounds()); });
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
  }
  function getStateCounts(list) {
    const counts = {};
    list.forEach(record => {
      const stateSet = new Set(record.places.map(place => place.state));
      stateSet.forEach(uf => { counts[uf] = (counts[uf] || 0) + 1; });
    });
    return counts;
  }

  function drawMap(list) {
    citySummary = getCitySummary(list);
    $("#visible-cities").textContent = String(citySummary.length);
    $("#visible-states").textContent = String(new Set(citySummary.map(place => place.state)).size);
    const missingLocation = list.filter(record => !record.places.length && !record.categories.includes("milestone")).length;
    $("#map-scope-note").textContent = missingLocation ? `${missingLocation} registro(s) de serviço ainda não têm município confirmado; permanecem na linha do tempo, sem ponto no mapa.` : "";
    renderLocationShortcuts();
    if (!map || !heatGroup || !pointGroup) return;
    heatGroup.clearLayers();
    pointGroup.clearLayers();
    mapStateCounts = getStateCounts(list);
    if (stateLayer) stateLayer.eachLayer(layer => {
      layer.setStyle(stateStyle(layer.feature, mapStateCounts));
      const uf = featureUf(layer.feature);
      const total = mapStateCounts[uf] || 0;
      layer.setTooltipContent(`${stateNames[uf] || uf} · ${total} registro(s) nesta seleção`);
    });
    updateMunicipalityStyles();
    if (!citySummary.length) return;
    const max = Math.max(...citySummary.map(place => place.count));
    citySummary.forEach(place => {
      const intensity = place.count / max;
      const color = intensity > .72 ? "#df473f" : intensity > .38 ? "#ee7955" : "#f0a477";
      const glow = L.circleMarker([place.lat, place.lon], {
        radius: 12 + Math.sqrt(place.count) * 8,
        stroke: false,
        fillColor: color,
        fillOpacity: .34,
        pane: "drsHeat",
        className: "tl-heat-spot",
        interactive: false
      });
      glow.addTo(heatGroup);
      const point = L.circleMarker([place.lat, place.lon], {
        radius: 4 + Math.min(5, Math.sqrt(place.count)),
        color: "#ffffff",
        weight: 1.5,
        fillColor: "#013539",
        fillOpacity: 1,
        pane: "drsPoints",
        bubblingMouseEvents: false
      });
      point.bindTooltip(`${place.city}, ${place.state} · ${place.count} registro(s)`, { direction: "top", offset: [0, -7], opacity: .96 });
      point.on("click", () => chooseCity(place.key, true));
      point.addTo(pointGroup);
    });
    window.requestAnimationFrame(() => map.invalidateSize());
  }

  function renderLocationShortcuts() {
    const container = $("#location-shortcuts");
    container.replaceChildren();
    const sortedCities = citySummary.slice().sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, "pt-BR"));
    const count = $("#location-count");
    if (count) count.textContent = `${citySummary.length} ${citySummary.length === 1 ? "município" : "municípios"}`;
    sortedCities.forEach(place => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tl-location-chip";
      button.textContent = `${place.city}, ${place.state} · ${place.count}`;
      button.setAttribute("aria-label", `Filtrar ${place.city}, ${place.state}: ${place.count} ${place.count === 1 ? "registro" : "registros"}`);
      button.setAttribute("aria-pressed", String(state.city === place.key));
      button.addEventListener("click", () => chooseCity(place.key, false));
      container.append(button);
    });
  }

  function chooseCity(key, fromMap) {
    state.city = state.city === key ? "" : key;
    state.shown = pageSize;
    renderAll();
    if (fromMap && window.matchMedia("(max-width: 950px)").matches) {
      $("#timeline-cards").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function cardElement(record, index) {
    const article = document.createElement("article");
    article.className = "tl-card";
    article.style.setProperty("--delay", `${Math.min(index, 8) * 35}ms`);
    const mediaWrap = document.createElement("div");
    mediaWrap.className = "tl-card-media-wrap";
    const image = document.createElement("img");
    image.className = "tl-card-media";
    image.dataset.recordId = record.id;
    image.loading = "lazy";
    image.alt = record.illustrativeImage ? `Imagem ilustrativa de ${record.service.toLocaleLowerCase("pt-BR")}; não é foto do serviço realizado` : record.media.length ? `${record.service} em ${record.locationLabel}` : "";
    if (record.media.length) {
      image.addEventListener("error", () => {
        image.src = "assets/logo-drs.png";
        image.alt = "Símbolo da DRS; imagem do registro indisponível";
        image.classList.add("tl-placeholder-media");
      }, { once: true });
      image.src = record.media[0];
    }
    else {
      image.src = "assets/logo-drs.png";
      image.alt = "Símbolo da DRS";
      image.classList.add("tl-placeholder-media");
    }
    mediaWrap.append(image);
    if (record.illustrativeImage) {
      const label = document.createElement("span");
      label.className = "tl-card-image-label";
      label.textContent = "Imagem ilustrativa";
      mediaWrap.append(label);
    }
    const body = document.createElement("div");
    body.className = "tl-card-body";
    const top = document.createElement("div");
    top.className = "tl-card-top";
    const date = document.createElement("span");
    date.className = "tl-card-date";
    date.textContent = dateText(record);
    const type = document.createElement("span");
    type.className = "tl-card-type";
    type.textContent = record.sourceType === "publicação do Instagram" ? "Instagram" : record.sourceType === "registro de campo" ? "Campo" : "Histórico";
    top.append(date, type);
    const title = document.createElement("h4");
    title.textContent = record.service;
    const place = document.createElement("div");
    place.className = "tl-card-place";
    place.textContent = `⌖ ${record.locationLabel}`;
    const tags = document.createElement("div");
    tags.className = "tl-card-tags";
    record.species.slice(0, 2).forEach(species => {
      const tag = document.createElement("span");
      tag.className = "tl-tag";
      tag.textContent = species;
      tags.append(tag);
    });
    if (record.area) {
      const tag = document.createElement("span");
      tag.className = "tl-tag";
      tag.textContent = record.area;
      tags.append(tag);
    }
    const open = document.createElement("button");
    open.className = "tl-card-open";
    open.type = "button";
    open.textContent = record.media.length > 1 ? `Ver registro e ${record.media.length} fotos ↗` : "Ver registro ↗";
    open.addEventListener("click", () => openRecord(record));
    body.append(top, title, place);
    if (tags.childElementCount) body.append(tags);
    body.append(open);
    article.append(mediaWrap, body);
    return article;
  }

  function openRecord(record) {
    dialogRecord = record;
    dialogImageIndex = 0;
    renderDialog();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function renderDialog() {
    const record = dialogRecord;
    if (!record) return;
    dialogContent.replaceChildren();
    const media = document.createElement("div");
    media.className = "tl-dialog-media";
    if (record.media.length) {
      const image = document.createElement("img");
      image.className = "tl-dialog-photo";
      image.dataset.recordId = record.id;
      image.src = record.media[dialogImageIndex];
      image.alt = record.illustrativeImage ? `Imagem ilustrativa de ${record.service.toLocaleLowerCase("pt-BR")}; não é foto do serviço realizado` : `${record.service} em ${record.locationLabel}`;
      image.addEventListener("error", () => {
        image.src = "assets/logo-drs.png";
        image.alt = "Símbolo da DRS; imagem do registro indisponível";
        image.classList.remove("tl-dialog-photo");
        image.removeAttribute("data-record-id");
        image.style.objectFit = "contain";
        image.style.padding = "40px";
      }, { once: true });
      media.append(image);
      if (record.illustrativeImage) {
        const caption = document.createElement("span");
        caption.className = "tl-dialog-image-label";
        caption.textContent = "Imagem ilustrativa; não é foto deste trabalho.";
        media.append(caption);
      }
      if (record.media.length > 1) {
        const previous = document.createElement("button");
        previous.className = "tl-gallery-control tl-gallery-prev";
        previous.type = "button";
        previous.textContent = "‹";
        previous.setAttribute("aria-label", "Foto anterior");
        previous.addEventListener("click", () => { dialogImageIndex = (dialogImageIndex - 1 + record.media.length) % record.media.length; renderDialog(); });
        const next = document.createElement("button");
        next.className = "tl-gallery-control tl-gallery-next";
        next.type = "button";
        next.textContent = "›";
        next.setAttribute("aria-label", "Próxima foto");
        next.addEventListener("click", () => { dialogImageIndex = (dialogImageIndex + 1) % record.media.length; renderDialog(); });
        const index = document.createElement("span");
        index.className = "tl-gallery-index";
        index.textContent = `${dialogImageIndex + 1} / ${record.media.length}`;
        media.append(previous, next, index);
      }
    } else {
      const placeholder = document.createElement("div");
      placeholder.style.cssText = "display:grid;place-items:center;height:100%;padding:36px;color:#b6cbc3;text-align:center;font:500 11px var(--tl-mono);letter-spacing:.1em;text-transform:uppercase";
      placeholder.textContent = "Registro de campo · DRS";
      media.append(placeholder);
    }
    const copy = document.createElement("div");
    copy.className = "tl-dialog-copy";
    const close = document.createElement("button");
    close.className = "tl-dialog-close";
    close.type = "button";
    close.setAttribute("aria-label", "Fechar detalhes");
    close.textContent = "×";
    close.addEventListener("click", () => dialog.close());
    const eyebrow = document.createElement("div");
    eyebrow.className = "tl-eyebrow";
    eyebrow.textContent = record.sourceType;
    const title = document.createElement("h2");
    title.id = "dialog-title";
    title.textContent = record.service;
    const summary = document.createElement("p");
    summary.textContent = record.summary || `Registro da DRS sobre ${record.service.toLocaleLowerCase("pt-BR")} em ${record.locationLabel}.`;
    const metadata = document.createElement("div");
    metadata.className = "tl-dialog-meta";
    const addMeta = (label, value) => {
      if (!value) return;
      const row = document.createElement("div");
      const small = document.createElement("small");
      small.textContent = label;
      const text = document.createElement("span");
      text.textContent = value;
      row.append(small, text);
      metadata.append(row);
    };
    addMeta("Período", dateText(record));
    addMeta("Local", record.locationLabel);
    addMeta("Serviço", record.service);
    addMeta("Espécies citadas", record.species.join(", "));
    addMeta("Área informada", record.area);
    const note = document.createElement("div");
    note.className = "tl-dialog-note";
    const noteTitle = document.createElement("strong");
    noteTitle.textContent = record.dateReference || "Referência cronológica";
    const noteCopy = document.createElement("span");
    noteCopy.textContent = record.dateNote || (record.displayDate ? "O ano foi confirmado; o mês e o dia exatos não foram informados." : record.dateIsWorkDate ? "O período de serviço aparece como informado na fonte reunida." : "Quando a data de campo não estava identificada, foi usado o mês da publicação como referência, conforme orientação do cliente.");
    note.append(noteTitle, noteCopy);
    copy.append(close, eyebrow, title, summary, metadata, note);
    dialogContent.append(media, copy);
  }

  function renderCards(list) {
    const ordered = normalizeRecordOrder(list);
    const visible = ordered.slice(0, state.shown);
    cardList.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "tl-empty";
      empty.textContent = "Nenhum registro encontrado com estes filtros. Ajuste a busca ou limpe os filtros para continuar explorando.";
      cardList.append(empty);
    } else {
      visible.forEach((record, index) => cardList.append(cardElement(record, index)));
    }
    const more = $("#load-more");
    more.hidden = ordered.length <= visible.length;
    more.textContent = `Carregar mais registros (${ordered.length - visible.length} restantes)`;
    $("#visible-count").textContent = String(list.length);
    $("#results-range").textContent = list.length ? `${visible.length} de ${list.length}` : "0 resultados";
    const yearText = state.year === "all" ? "Todos os registros" : `Registros de ${state.month === "all" ? state.year : `${fullMonths[Number(state.month) - 1]} de ${state.year}`}`;
    $("#results-title").textContent = state.city ? `Registros em ${state.city.split("|")[0]}` : yearText;
    if (state.city) {
      $("#selected-city-wrap").classList.add("is-visible");
      $("#selected-city-name").textContent = `${state.city.split("|")[0]}, ${state.city.split("|")[1]}`;
    } else {
      $("#selected-city-wrap").classList.remove("is-visible");
      $("#selected-city-name").textContent = "";
    }
  }

  function renderPeriodHint() {
    if (state.year === "all") $("#period-hint").textContent = "Todos os anos e meses · registros em ordem cronológica";
    else if (state.month === "all") $("#period-hint").textContent = `Todos os meses de ${state.year} · selecione uma faixa para explorar mais de perto`;
    else $("#period-hint").textContent = `${fullMonths[Number(state.month) - 1]} de ${state.year} · publicações e períodos de campo registrados`;
    yearControls.querySelectorAll(".tl-year").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.year === String(state.year))));
  }

  function renderAll() {
    renderMonthControls();
    renderPeriodHint();
    const list = visibleRecords();
    drawMap(list);
    renderCards(list);
  }

  function stopPlayback() {
    if (state.playTimer) window.clearInterval(state.playTimer);
    state.playTimer = null;
    state.playing = false;
    const button = $("#play-timeline");
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = "<span aria-hidden=\"true\">▶</span> Percorrer anos";
  }

  function startPlayback() {
    const sequence = years.map(String);
    if (!sequence.length) return;
    state.playing = true;
    const button = $("#play-timeline");
    button.setAttribute("aria-pressed", "true");
    button.innerHTML = "<span aria-hidden=\"true\">Ⅱ</span> Pausar";
    let index = Math.max(0, sequence.indexOf(String(state.year)));
    if (state.year === "all" || index === sequence.length - 1) index = -1;
    const advance = () => {
      index += 1;
      if (index >= sequence.length) {
        stopPlayback();
        return;
      }
      state.year = sequence[index];
      state.month = "all";
      state.city = "";
      state.shown = pageSize;
      renderAll();
    };
    advance();
    state.playTimer = window.setInterval(advance, 1650);
  }

  function wireControls() {
    $("#record-search").addEventListener("input", event => {
      state.query = event.target.value.trim().toLocaleLowerCase("pt-BR");
      state.shown = pageSize;
      renderAll();
    });
    $("#service-filter").addEventListener("change", event => {
      state.service = event.target.value;
      state.shown = pageSize;
      renderAll();
    });
    $("#clear-filters").addEventListener("click", () => {
      stopPlayback();
      state.year = "all";
      state.month = "all";
      state.service = "all";
      state.query = "";
      state.city = "";
      state.shown = pageSize;
      $("#record-search").value = "";
      $("#service-filter").value = "all";
      renderAll();
    });
    $("#clear-city").addEventListener("click", () => chooseCity("", false));
    $("#load-more").addEventListener("click", () => { state.shown += pageSize; renderCards(visibleRecords()); });
    $("#play-timeline").addEventListener("click", () => state.playing ? stopPlayback() : startPlayback());
    const menu = $(".tl-menu");
    const nav = $("#tl-navigation");
    menu.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("is-open");
      menu.setAttribute("aria-expanded", String(isOpen));
      menu.setAttribute("aria-label", isOpen ? "Fechar menu" : "Abrir menu");
      menu.textContent = isOpen ? "×" : "☰";
    });
    nav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      menu.setAttribute("aria-expanded", "false");
      menu.setAttribute("aria-label", "Abrir menu");
      menu.textContent = "☰";
    }));
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  }

  function renderHeroStats() {
    $("#hero-post-count").textContent = String(allPosts.length);
    const locations = new Set(records.flatMap(record => record.places.map(cityKey)));
    $("#hero-city-count").textContent = String(locations.size);
  }

  buildServiceFilter();
  renderHeroStats();
  buildYearControls();
  createMap();
  wireControls();
  renderAll();
})();
