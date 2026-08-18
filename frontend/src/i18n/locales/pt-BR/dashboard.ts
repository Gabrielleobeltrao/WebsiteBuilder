export default {
  overview: {
    title: "Painel",
    description: "O que existe nesta conta e o que ela recebeu.",
    loading: "Carregando o painel…",
    error: {
      title: "Não conseguimos carregar o painel",
      retry: "Tentar novamente",
    },
    filters: {
      site: "Site",
      allSites: "Todos os sites",
      period: "Período",
      lastDays_one: "Último dia",
      lastDays_other: "Últimos {{count}} dias",
    },
    metrics: {
      views: "Acessos contados no servidor",
      sites: "Sites",
      pages: "Páginas",
      submissions: "Formulários",
      unread_one: "{{count}} não lido",
      unread_other: "{{count}} não lidos",
      noForms: "Nenhum formulário criado ainda",
    },
    chart: {
      title: "Acessos por dia",
      summary: "Pico de {{peak}} em um dia, ao longo de {{days}} dias.",
    },
    pages: {
      title: "Páginas mais acessadas",
      page: "Página",
      site: "Site",
      empty: "Nenhum acesso registrado neste período.",
    },
    sites: {
      title: "Sites recentes",
    },
  },

  sites: {
    title: "Sites",
    description: "Todos os sites deste espaço de trabalho.",
    create: "Novo site",
    createTitle: "Dê um nome ao site",
    nameLabel: "Nome do site",
    namePlaceholder: "Acme Studio",
    confirmCreate: "Criar site",
    cancel: "Cancelar",
    open: "Abrir",
    panel: "Painel",
    visit: "Ver site",
    notPublished: "Ainda não publicado",
    noAddress: "Publicado, mas ainda sem endereço",
    rename: "Renomear",
    renameTitle: "Renomear site",
    confirmRename: "Salvar nome",
    delete: "Excluir",
    deleteTitle: "Excluir este site?",
    deleteWarning: "O site e tudo que há nele serão removidos. Não é possível desfazer.",
    confirmDelete: "Excluir site",
    pageCount_one: "{{count}} página",
    pageCount_other: "{{count}} páginas",
    updatedAt: "Atualizado {{when}}",
    address: "Endereço",
    empty: {
      title: "Nenhum site ainda",
      description: "Crie o primeiro para começar a construir.",
    },
    loading: "Carregando sites…",
    error: {
      title: "Não conseguimos carregar seus sites",
      retry: "Tentar novamente",
    },
    saving: "Salvando…",
  },

  "media": {
    "title": "Mídia",
    "description": "Imagens disponíveis para todos os sites deste espaço de trabalho.",
    "upload": "Enviar imagem",
    "uploading": "Enviando…",
    "select": "Usar esta imagem",
    "remove": "Excluir",
    "removeTitle": "Excluir esta imagem?",
    "removeWarning": "Qualquer elemento que ainda a use mostrará um espaço reservado. Não é possível desfazer.",
    "confirmRemove": "Excluir imagem",
    "altLabel": "Descrição padrão",
    "dimensions": "{{width}} x {{height}}",
    "variants_one": "{{count}} tamanho",
    "variants_other": "{{count}} tamanhos",
    "empty": {
      "title": "Nenhuma imagem ainda",
      "description": "Envie uma para reutilizar em suas páginas."
    },
    "loading": "Carregando mídia…",
    "error": "Não conseguimos carregar sua mídia",
    "rejected": "Este arquivo não é uma imagem aceita. Use JPEG, PNG ou WebP.",
    "tooLarge": "Esta imagem é grande demais. O limite é 12 MB.",
    "search": "Buscar por nome do arquivo",
    "noMatches": "Nenhuma imagem corresponde a essa busca."
  },

  "site": {
    "title": "Site",
    "overview": "Visão geral",
    "pages": "Páginas",
    "editSite": "Editar site",
    "preview": "Pré-visualizar",
    "core": "Site",
    "optional": "Módulos",
    "settings": "Configurações",
    "nav": {
      "blog": "Blog",
      "forms": "Formulários",
      "cms": "CMS",
      "search": "Busca"
    },
    "badge": {
      "needs_setup": "Configuração pendente",
      "error": "Requer atenção",
      "draft": "Rascunho",
      "published": "No ar",
      "ready": "Pronto"
    },
    "issues_one": "{{count}} pendência",
    "issues_other": "{{count}} pendências",
    "warnings_one": "{{count}} aviso",
    "warnings_other": "{{count}} avisos",
    "status": {
      "title": "Status do site",
      "ready": "Nada está bloqueando a publicação.",
      "blocked": "Conclua a configuração antes de publicar.",
      "loading": "Verificando o status do site…",
      "error": "Não conseguimos verificar o status deste site"
    },
    "cards": {
      "pages": "Páginas",
      "posts": "Posts publicados",
      "modules": "Módulos ativos",
      "lastUpdate": "Última atualização"
    },
    "startModule": "Ainda não usa:",
    "noOptionalModules": "Nenhum módulo opcional está em uso ainda."
  },

  "seo": {
    "siteName": "Nome do site",
    "titleTemplate": "Modelo de título",
    "titleTemplateHint": "Use %s para o título da página e %site% para o nome do site.",
    "defaultDescription": "Descrição padrão",
    "canonicalBaseUrl": "URL base canônica",
    "canonicalHint": "Sem isso, nenhuma URL canônica é gerada. Adivinhar uma é pior do que omitir.",
    "locale": "Idioma do site",
    "localeHint": "O idioma do site publicado, não desta interface.",
    "defaultRobots": "Indexação padrão",
    "save": "Salvar configurações de SEO",
    "saving": "Salvando…",
    "saved": "Configurações de SEO salvas",
    "invalid": "Alguns valores não são válidos. Confira a URL canônica."
  },
} as const;
