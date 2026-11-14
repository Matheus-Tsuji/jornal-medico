# Decisões que dependem dos fundadores

Lista viva. Nada aqui foi decidido pela engenharia; os valores atuais são defaults reversíveis.

| Tema | Situação atual (default) | Precisa de |
|---|---|---|
| Nome e marca | "Jornal Médico", monograma serif provisório | Nome definitivo, identidade, domínio |
| Escopo clínico | Clínica médica: hipertensão, diabetes, insuficiência cardíaca | Validar temas e a taxonomia das 5 áreas com médicos |
| Responsável editorial | Qualquer usuário com papel `editor` aprova | Quem são os editores qualificados; critérios escritos de aprovação |
| Uso de abstracts | Guardados só para análise interna, não republicados | Parecer jurídico sobre uso comercial de abstracts/resumos derivados |
| Fontes pagas/licenças | Só PubMed integrado | Quais fontes (NEJM, JAMA, Lancet, SciELO, sociedades) e com que licença |
| Qualis histórico | Não importado ("indisponível") | Se vale exibir, com tabela oficial e ressalvas |
| Preço e gateway | Sandbox; R$ 49,90 (ativo) e R$ 99,90 (inativo) | Preço, gateway brasileiro com recorrência, plano anual/estudante/teste grátis |
| Paywall | Desligado no beta | Quando ligar e o que fica gratuito |
| Orçamento de IA | 20 artigos/dia; sem limite em USD (sem tabela de preços) | Orçamento diário/mensal e preços oficiais em `ai-pricing.json` |
| Modelos OpenAI | Não definidos | IDs do catálogo do projeto para análise e redação |
| E-mail transacional | Caixa local (dev); Resend implementado e não testado | Provedor, domínio remetente, SPF/DKIM |
| Dados pessoais / LGPD | Minimização, exportação e exclusão implementadas | Revisão jurídica, política de privacidade, retenção, encarregado (DPO) |
| Hospedagem | Nenhuma | Provedor com volume persistente, ambientes dev/staging/prod |
| Integrações | Notion, ClickUp, áudio, vídeo, PWA: flags desligadas, não implementadas | Prioridade e contas |
| Publicação automática | Não existe: sempre há revisão humana | Critérios aprovados por especialistas antes de qualquer automação |
