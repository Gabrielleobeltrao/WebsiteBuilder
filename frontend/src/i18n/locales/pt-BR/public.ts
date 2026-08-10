export default {
  nav: {
    label: "Navegação principal",
    home: "Início",
    roadmap: "Roadmap",
  },
  landing: {
    metaTitle: "Website Builder — crie, publique e gerencie sites de clientes",
    metaDescription:
      "Monte páginas visualmente, controle o comportamento responsivo em qualquer largura e publique em um domínio real a partir de um único espaço de trabalho.",
    hero: {
      eyebrow: "Criação visual de sites",
      title: "Desenhe a página. Mantenha o controle.",
      subtitle:
        "Arraste os elementos exatamente para onde você quer, ou deixe a seção se organizar sozinha. Os dois modos convivem na mesma página e continuam responsivos em qualquer largura.",
      primaryCta: "Começar a criar",
      secondaryCta: "Ver o roadmap",
    },
    demo: {
      title: "Uma tela, duas formas de trabalhar",
      description:
        "Seções livres funcionam como uma prancheta: oito alças, geometria precisa em pixels, sobreposição permitida. Seções grid e flex se organizam sozinhas e continuam editáveis. A escolha é por seção, não por página.",
      freeLabel: "Seção livre",
      structuredLabel: "Seção grid",
    },
    benefits: {
      title: "Feito para trabalho que vai ao ar",
      items: {
        responsive: {
          title: "Responsivo por construção",
          description:
            "Restrições, container queries e tipografia fluida resolvem igual no editor, na pré-visualização e no site publicado.",
        },
        multitenant: {
          title: "Agências e criadores independentes",
          description:
            "Um único modelo de espaço de trabalho cobre desde um site pessoal até uma agência com muitos clientes. Nada é remendado depois.",
        },
        publishing: {
          title: "Publicação com volta atrás",
          description:
            "Cada publicação é uma versão imutável. Volte para qualquer versão anterior sem reconstruir o rascunho.",
        },
        content: {
          title: "Conteúdo que escala",
          description:
            "Blog, coleções de CMS reutilizáveis e formulários nativos compartilham os mesmos templates e o mesmo renderizador.",
        },
      },
    },
    features: {
      title: "O que existe no produto",
      items: {
        editor: "Editor visual com seções livres, grid e flex",
        media: "Biblioteca de mídia com variantes WebP automáticas",
        seo: "SEO de site, página e dinâmico, com sitemap e robots",
        forms: "Formulários nativos com envios protegidos e exportação CSV",
        cms: "Coleções personalizadas com templates de listagem e detalhe",
        domains: "Subdomínio da plataforma e domínios próprios verificados",
      },
    },
    useCases: {
      title: "Duas formas de usar",
      agency: {
        title: "Para agências",
        description:
          "Agrupe sites por cliente, convide seu time com papéis definidos e acompanhe campanhas e prontidão em um único painel.",
      },
      selfService: {
        title: "Para um site só",
        description:
          "Ao criar a conta, seu espaço de trabalho pessoal já existe. Crie o site, publique e conecte um domínio.",
      },
    },
    workflow: {
      title: "Três passos",
      steps: {
        one: { title: "Monte", description: "Adicione seções e elementos e defina como eles se comportam quando a largura muda." },
        two: { title: "Revise", description: "Audite acessibilidade, links, responsividade e desempenho antes de qualquer visitante." },
        three: { title: "Publique", description: "Envie uma versão imutável para seu subdomínio ou para o domínio do cliente." },
      },
    },
    roadmapPreview: {
      title: "Para onde o produto está indo",
      description: "Tudo abaixo é público, e nada que está planejado é descrito como se já existisse.",
      cta: "Abrir o roadmap completo",
    },
    faq: {
      title: "Perguntas",
      items: {
        code: {
          question: "Posso colar HTML, CSS ou JavaScript próprio?",
          answer:
            "Não. Todo valor é tipado e validado, e é isso que torna seguro servir o resultado publicado de vários clientes a partir de um único renderizador.",
        },
        mobile: {
          question: "Dá para editar pelo celular?",
          answer:
            "A edição exige uma tela de computador e um ponteiro preciso. No celular você tem uma pré-visualização somente leitura dos layouts de desktop e mobile.",
        },
        domain: {
          question: "O domínio continua sendo meu?",
          answer:
            "Sim. O domínio permanece registrado no seu nome. Você aponta um subdomínio para a plataforma e o certificado é gerenciado para você.",
        },
        export: {
          question: "Meu conteúdo fica preso na plataforma?",
          answer:
            "As páginas são guardadas como dados estruturados, não como HTML gerado. A exportação estática está planejada, mas ainda não está disponível.",
        },
      },
    },
    finalCta: {
      title: "Crie a primeira página",
      description: "Crie uma conta e seu espaço de trabalho fica pronto na hora.",
      action: "Criar conta",
    },
    footer: {
      tagline: "Construtor visual de sites para agências e criadores independentes.",
      legal: "Jurídico",
      terms: "Termos de serviço",
      privacy: "Política de privacidade",
      product: "Produto",
      rights: "Todos os direitos reservados.",
    },
  },
  roadmap: {
    metaTitle: "Roadmap — Website Builder",
    metaDescription: "O que está lançado, em andamento, planejado e em avaliação no Website Builder.",
    title: "Roadmap do produto",
    intro:
      "Visão pública do que o produto faz hoje e do que vem a seguir. Itens sem período informado não têm data assumida.",
    legend: "Legenda de status",
    filterLabel: "Filtrar por status",
    allStatuses: "Todos",
    empty: "Nenhum item corresponde a este filtro.",
    targetPeriod: "Previsão",
    noTarget: "Sem data assumida",
    cta: { title: "Quer experimentar o que já funciona?", action: "Criar conta" },
    status: {
      released: "Lançado",
      in_progress: "Em andamento",
      planned: "Planejado",
      under_consideration: "Em avaliação",
    },
    statusDescription: {
      released: "Disponível no produto hoje.",
      in_progress: "Está sendo construído agora.",
      planned: "Assumido, ainda não iniciado.",
      under_consideration: "Em avaliação. Pode não ser lançado.",
    },
    category: {
      editor: "Editor",
      content: "Conteúdo",
      publishing: "Publicação",
      collaboration: "Colaboração",
      platform: "Plataforma",
    },
    items: {
      "visual-editor": {
        title: "Editor visual com seções híbridas",
        description: "Seções livres, grid e flex na mesma página, com redimensionamento por oito alças e histórico de desfazer.",
      },
      "responsive-system": {
        title: "Controles responsivos fluidos",
        description: "Breakpoints personalizados, restrições, container queries e pré-visualização em largura contínua.",
      },
      "media-library": {
        title: "Biblioteca de mídia com otimização WebP",
        description: "Os envios são convertidos em variantes WebP responsivas no servidor.",
      },
      blog: {
        title: "Blog com templates reutilizáveis",
        description: "Desenhe um template de artigo e um de listagem; todos os posts seguem os dois.",
      },
      "cms-collections": {
        title: "Coleções de CMS personalizadas",
        description: "Campos tipados com templates de listagem e detalhe para serviços, portfólio e mais.",
      },
      forms: {
        title: "Formulários e envios nativos",
        description: "Formulários acessíveis, envios protegidos, painel e exportação CSV.",
      },
      publishing: {
        title: "Publicação com volta atrás",
        description: "Versões imutáveis, ativação atômica e retorno em um clique.",
      },
      "custom-domains": {
        title: "Domínios próprios com SSL gerenciado",
        description: "Conecte um subdomínio do cliente por CNAME e receba um certificado gerenciado.",
      },
      "site-audit": {
        title: "Auditoria de acessibilidade e prontidão",
        description: "Achados de acessibilidade, links quebrados, responsividade e desempenho antes de publicar.",
      },
      "static-export": {
        title: "Exportação estática",
        description: "Exportar uma versão publicada como arquivos estáticos para hospedagem em CDN.",
      },
      collaboration: {
        title: "Colaboração em tempo real",
        description: "Vários editores no mesmo documento, com comentários e histórico de versões.",
      },
      "ai-assist": {
        title: "Layout e texto assistidos por IA",
        description: "Gerar seções e conteúdo no mesmo schema estruturado que o editor já usa.",
      },
      analytics: {
        title: "Analytics próprio",
        description: "Dados de tráfego por site e página respeitando privacidade, sem número inventado antes de existir.",
      },
      "multilingual-sites": {
        title: "Sites de clientes multilíngues",
        description: "Variantes de idioma por página com URLs e SEO próprios. Separado da interface bilíngue.",
      },
    },
  },
  auth: {
    placeholderTitle: "A autenticação chega junto com as contas",
    placeholderDescription:
      "O cadastro e o login são ligados ao serviço real de autenticação em uma fase posterior. Esta página é um espaço reservado.",
    backHome: "Voltar para o início",
  },
  notFound: {
    title: "Página não encontrada",
    description: "O endereço que você abriu não existe.",
    action: "Voltar para o início",
  },
} as const;
