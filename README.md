# Site DRS

Site institucional da DRS Consultoria e Tecnologia Florestal, construído com HTML,
CSS e JavaScript estáticos.

## Páginas

- `drs-landing-demo/index.html` — página inicial.
- `drs-landing-demo/projetos.html` — projetos, linha do tempo interativa e mapa.
- `drs-landing-demo/assets/` — estilos, scripts, dados publicados, imagens e logo.

## Visualização local

Entre na pasta `drs-landing-demo` e execute:

```powershell
python -m http.server 8000
```

Depois abra <http://localhost:8000>. O projeto não precisa de etapa de build. O
mapa e os recursos externos precisam de conexão com a internet.

## Site publicado

- <https://drsflorestal.com.br/>
- <https://drsflorestal.com.br/projetos.html>

O código de configuração do mapa inclui uma chave pública de navegador protegida
por restrições de origem no MapTiler. Não adicione senhas ou tokens privados ao
repositório.