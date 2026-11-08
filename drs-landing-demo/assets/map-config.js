// Chave pública MapTiler; as origens permitidas também estão limitadas no painel MapTiler.
const authorizedMapHosts = new Set(["localhost", "127.0.0.1", "magical-sherbet-44ee38.netlify.app", "drsconsultoriatecflorestal.netlify.app", "drsflorestal.com.br"]);
const mapTilerKey = "cUFgTnyIeajhHGKNHp4a";
window.DRS_MAP_CONFIG = {
  mapTilerKey: authorizedMapHosts.has(window.location.hostname.toLowerCase()) ? mapTilerKey : ""
};