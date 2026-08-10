export default {
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
    "noOptionalModules": "Nenhum módulo opcional está em uso ainda. Adicione um bloco pelo painel Elementos para ativar um."
  },
} as const;
