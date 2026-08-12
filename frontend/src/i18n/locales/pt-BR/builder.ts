export default {
  topBar: {
    backToSites: "Voltar para sites",
    undo: "Desfazer",
    redo: "Refazer",
    save: "Salvar",
    preview: "Pré-visualizar",
    publish: "Publicar",
    currentPage: "Página atual",
    zoom: "Zoom",
    fit: "Ajustar",
  },
  saveState: {
    clean: "Todas as alterações salvas",
    dirty: "Alterações não salvas",
    saving: "Salvando…",
    saved: "Salvo {{when}}",
    error: "Não foi possível salvar",
    conflict: "Alterado em outro lugar",
    retry: "Tentar novamente",
    reload: "Recarregar a versão mais recente",
    conflictTitle: "Este site foi alterado em outro lugar",
    conflictDescription:
      "Alguém salvou uma versão mais recente enquanto você editava. Recarregar descarta as alterações feitas aqui.",
    unsavedWarning: "Você tem alterações não salvas. Sair mesmo assim?",
  },
  panel: {
    label: "Controles do construtor",
    destinations: "Destinos do construtor",
    pages: "Páginas",
    elements: "Adicionar elementos",
    layers: "Estrutura",
    pageSettings: "Configurações da página",
    siteSettings: "Configurações do site",
    sectionInspector: "Seção",
    elementInspector: "Elemento",
    back: "Voltar",
    breadcrumb: "Você está editando",
  },
  pageCanvas: {
    background: "Cor de fundo",
    minHeight: "Altura mínima (px)",
  },
  siteSettings: {
    name: "Nome do site",
    seoSiteName: "Nome usado nos resultados de busca",
    titleTemplate: "Modelo de título",
    titleTemplateHint: "%s vira o título da página e %site% vira o nome do site.",
    defaultDescription: "Descrição padrão",
    locale: "Idioma publicado",
    localeHint: "O idioma do site publicado. Não altera o idioma que você lê aqui.",
    robotsIndex: "Permitir que buscadores indexem este site",
    robotsFollow: "Permitir que buscadores sigam os links dele",
    elsewhere: "Em outro lugar",
    publish: "Publicação e versões",
    domains: "Domínios",
    feature: {
      blog: "Blog",
      cms: "Conteúdo",
      forms: "Formulários",
      search: "Busca",
    },
  },
  pages: {
    title: "Páginas",
    add: "Adicionar página",
    addTitle: "Dê um nome à página",
    nameLabel: "Nome da página",
    rename: "Renomear",
    duplicate: "Duplicar",
    delete: "Excluir",
    deleteTitle: "Excluir esta página?",
    deleteWarning: "A página e tudo que há nela serão removidos. Você pode desfazer.",
    setHome: "Definir como página inicial",
    home: "Página inicial",
    lastPage: "Um site precisa de pelo menos uma página.",
    address: "Endereço",
  },
  canvas: {
    label: "Tela da página",
    emptySection: "Esta seção está vazia. Adicione um elemento pelo painel Elementos.",
  },
  layers: {
    title: "Camadas",
    empty: "Nada nesta página ainda.",
    locked: "Bloqueado",
    hidden: "Oculto",
  },
  elements: {
    title: "Elementos",
    text: "Texto",
    image: "Imagem",
    button: "Botão",
    container: "Contêiner",
    section: "Seção",
    icon: "Ícone",
    iconList: "Lista com ícones",
    divider: "Divisor",
    spacer: "Espaçador",
    accordion: "Perguntas frequentes",
    tabs: "Abas",
    gallery: "Galeria",
    video: "Vídeo",
    socialLinks: "Redes sociais",
    downloadButton: "Download",
    breadcrumbs: "Trilha de navegação",
    table: "Tabela",
    pricingTable: "Tabela de preços",
    announcementBar: "Barra de aviso",
  },
  inspector: {
    tabs: "Configurações do elemento",
    content: "Conteúdo",
    style: "Estilo",
    layout: "Layout",
    responsive: "Responsivo",
    advanced: "Avançado",
    canvas: "Tela",
    seo: "SEO",
    displayName: "Nome de exibição",
    duplicate: "Duplicar",
    lock: "Bloquear",
    unlock: "Desbloquear",
    hide: "Ocultar",
    show: "Mostrar",
    delete: "Excluir",
  },
  gate: {
    title: "Continue editando em um computador",
    description:
      "O editor visual precisa de uma tela mais larga e de um ponteiro preciso. Você ainda pode pré-visualizar este site aqui.",
    resizeTitle: "Aumente o tamanho da janela para continuar editando",
    resizeDescription: "Seu trabalho não salvo foi mantido. A edição volta assim que a janela ficar larga o bastante.",
    previewDesktop: "Pré-visualização desktop",
    previewMobile: "Pré-visualização mobile",
    savedAt: "Salvo pela última vez {{when}}",
  },

  "fields": {
    "content": "Conteúdo",
    "text": "Texto",
    "tag": "Tag",
    "alt": "Texto alternativo",
    "decorative": "Imagem decorativa",
    "imageSource": "Origem da imagem",
    "imageUrl": "URL da imagem",
    "fontFamily": "Fonte",
    "fontSize": "Tamanho da fonte",
    "fontWeight": "Peso",
    "fontStyle": "Estilo",
    "textAlign": "Alinhamento",
    "color": "Cor",
    "lineHeight": "Altura da linha",
    "backgroundColor": "Fundo",
    "textColor": "Cor do texto",
    "borderRadius": "Arredondamento",
    "objectFit": "Ajuste",
    "horizontalAlign": "Alinhamento horizontal",
    "width": "Largura",
    "height": "Altura",
    "x": "X",
    "y": "Y",
    "zIndex": "Camada",
    "linkKind": "Link para",
    "linkPage": "Página",
    "linkUrl": "Endereço",
    "linkEmail": "E-mail",
    "linkPhone": "Telefone",
    "linkMessage": "Mensagem",
    "newTab": "Abrir em nova aba",
    "icon": "Ícone",
    "iconPosition": "Posição do ícone",
    "locked": "Bloqueado",
    "hidden": "Oculto",
    "displayName": "Nome de exibição"
  },
  "preview": {
      "width": "Largura da previsão",
      "exactWidth": "Largura exata em pixels",
      "presets": {
        "phone-small": "320",
        "phone": "390",
        "tablet": "768",
        "laptop": "1280",
        "desktop": "1440",
        "wide": "1920"
      },
      "diagnostics": {
        "title": "{{count}} ponto para conferir",
        "title_other": "{{count}} pontos para conferir",
        "clear": "Nenhum problema de layout em nenhuma largura.",
        "severity": {
          "error": "Quebra",
          "warning": "Conferir",
          "manual-review": "Revisar"
        }
      }
    },
  "options": {
    "autoMode": {
      "fixed": "Número fixo de colunas",
      "auto-fit": "Ajustar — recolher colunas vazias",
      "auto-fill": "Preencher — manter colunas vazias"
    },
    "tag": {
      "h1": "Título 1",
      "h2": "Título 2",
      "h3": "Título 3",
      "h4": "Título 4",
      "h5": "Título 5",
      "h6": "Título 6",
      "p": "Parágrafo"
    },
    "fontStyle": {
      "normal": "Normal",
      "italic": "Itálico"
    },
    "align": {
      "left": "Esquerda",
      "center": "Centro",
      "right": "Direita"
    },
    "objectFit": {
      "cover": "Cobrir",
      "contain": "Conter",
      "fill": "Preencher"
    },
    "source": {
      "empty": "Nenhuma",
      "url": "URL externa",
      "media": "Biblioteca de mídia"
    },
    "link": {
      "none": "Nada ainda",
      "internal": "Uma página deste site",
      "external": "Endereço externo",
      "email": "E-mail",
      "phone": "Telefone",
      "whatsapp": "WhatsApp"
    },
    "iconPosition": {
      "before": "Antes do texto",
      "after": "Depois do texto"
    }
  },
  "validation": {
    "unsafeUrl": "Somente endereços https são aceitos.",
    "missingPage": "A página vinculada não existe mais. Escolha outra.",
    "invalidEmail": "Informe um e-mail válido.",
    "invalidPhone": "Informe um telefone com 6 a 20 dígitos."
  },
  "zorder": {
    "forward": "Trazer para frente",
    "backward": "Enviar para trás",
    "front": "Trazer para a frente de tudo",
    "back": "Enviar para o fundo"
  },

  "section": {
    "layoutMode": "Modo de layout",
    "mode": {
      "free": "Livre",
      "grid": "Grade",
      "flex": "Flex"
    },
    "columns": "Colunas",
    "autoMode": "Comportamento das colunas",
    "minColumnWidth": "Largura mínima da coluna",
    "rowGap": "Espaço entre linhas",
    "columnGap": "Espaço entre colunas",
    "gap": "Espaçamento",
    "paddingX": "Espaçamento horizontal",
    "paddingY": "Espaçamento vertical",
    "direction": "Direção",
    "wrap": "Quebra",
    "justifyContent": "Distribuição",
    "alignItems": "Alinhamento",
    "directions": {
      "row": "Linha",
      "row-reverse": "Linha invertida",
      "column": "Coluna",
      "column-reverse": "Coluna invertida"
    },
    "wraps": {
      "nowrap": "Linha única",
      "wrap": "Quebrar",
      "wrap-reverse": "Quebrar invertido"
    },
    "justify": {
      "start": "Início",
      "center": "Centro",
      "end": "Fim",
      "space-between": "Espaço entre",
      "space-around": "Espaço ao redor",
      "space-evenly": "Espaço uniforme"
    },
    "align": {
      "start": "Início",
      "center": "Centro",
      "end": "Fim",
      "stretch": "Esticar"
    },
    "responsiveHint": "As sobrescritas por breakpoint desta seção chegam com os controles responsivos.",
    "convertTitle": "Mudar o layout desta seção?",
    "convertLosesPositions": "Esta seção tem {{count}} elemento(s) posicionado(s) livremente. Eles mantêm tamanho e conteúdo, e serão organizados na ordem visual atual. Você pode desfazer.",
    "convertKeepsContent": "Esta seção tem {{count}} elemento(s). Nada é removido, e você pode desfazer.",
    "convertConfirm": "Mudar layout"
  },

  "responsive": {
    "device": "Dispositivo",
    "autoFix": "Ajustar a este dispositivo",
    "autoFixHint": "Cria um override só para este dispositivo. O desktop não é tocado, e dá para desfazer.",
    "autoFixNothing": "Neste dispositivo já cabe tudo.",
    "autoFixDone": "{{count}} elemento(s) ajustado(s) neste dispositivo.",
    "canvasWidth": "Largura da tela",
    "preset": {
      "desktop": "Desktop",
      "tablet": "Tablet",
      "mobile": "Mobile"
    },
    "origin": {
      "base": "Valor base",
      "inherited": "Herdado de {{breakpoint}}",
      "override": "Sobrescrito aqui"
    },
    "reset": "Voltar ao herdado",
    "editingAt": "Editando em {{width}}px"
  },

  "seo": {
    "title": "SEO",
    "pageTitle": "Título de SEO",
    "pageDescription": "Meta descrição",
    "canonicalPath": "Caminho canônico",
    "robotsIndex": "Permitir que buscadores indexem esta página",
    "robotsFollow": "Permitir que buscadores sigam os links desta página",
    "ogTitle": "Título social",
    "ogDescription": "Descrição social",
    "ogType": "Tipo social",
    "twitterCard": "Tamanho do card",
    "structuredData": "Tipo da página",
    "preview": "Prévia do resultado de busca",
    "previewNote": "Como esta página pode aparecer. A aparência é decidida pelos buscadores, não por esta prévia.",
    "inherited": "Herdado das configurações do site",
    "reset": "Usar o padrão do site",
    "titleCount": "{{count}} de {{max}} caracteres",
    "cardOptions": {
      "summary": "Pequeno",
      "summary_large_image": "Imagem grande"
    },
    "ogTypes": {
      "website": "Site",
      "article": "Artigo"
    },
    "pageTypes": {
      "WebPage": "Página",
      "AboutPage": "Sobre",
      "ContactPage": "Contato",
      "Article": "Artigo"
    },
    "noRanking": "Estas verificações descrevem a página. Elas não preveem posicionamento em buscadores."
  },
  loading: "Carregando o site…",
  loadError: "Não conseguimos abrir este site",
} as const;
