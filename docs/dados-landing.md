# Dados para a landing do Echo

Dados verificáveis para a landing da demo, organizados pelos temas que o Echo ataca. Cada frase em inglês foi conferida na página ou no PDF original em 7/11/2026. Nenhum número foi arredondado: onde a landing usa uma soma ou um recorte, isso está dito.

**Regra de uso:** a landing cita a fonte e o ano junto do número (ex.: "Stack Overflow Developer Survey 2024"). Pesquisas feitas por empresas que vendem soluções estão marcadas como **pesquisa de fornecedor**.

---

## O "55%" do exemplo não existe nessas fontes

Não encontrei nenhuma pesquisa séria com "55% dos devs sofrem com a espera de resposta". O dado real mais próximo é este:

> **53%** dos desenvolvedores concordam ou concordam totalmente que "Waiting on answers to questions often causes interruptions and disrupts my workflow."
> Stack Overflow Developer Survey 2024 (28.747 respostas a essa pergunta).

Existe um "55%" sobre férias ("55% feel at least some pressure... to remain reachable while on vacation"), mas ele vem de uma enquete da NumberBarn, uma empresa de números de telefone, sem metodologia publicada. **Não recomendo usar.**

---

## Destaque principal: as 5 melhores opções

| # | Número | Frase para a landing | Por que é forte |
|---|--------|----------------------|-----------------|
| 1 | **53%** | "53% dos devs dizem que esperar por respostas interrompe e atrapalha o trabalho." | Mais próximo do exemplo, amostra grande, fonte neutra. Ver [1.1](#11-esperar-resposta-atrapalha-o-trabalho). |
| 2 | **65%** | "Em 65% dos projetos populares do GitHub, bastam 2 pessoas saírem para o projeto travar." | Artigo acadêmico revisado por pares. Fala direto de conhecimento concentrado e ausência. Ver [5.1](#51-bus-factor-de-projetos-populares). |
| 3 | **A cada 2 minutos** | "No horário comercial, quem trabalha é interrompido a cada 2 minutos." | Dados de uso reais do Microsoft 365, não opinião. Ver [2.1](#21-interrompido-a-cada-2-minutos). |
| 4 | **61%** | "61% dos devs passam mais de 30 minutos por dia procurando respostas." | Amostra grande, fonte neutra. Ver [7.1](#71-mais-de-30-minutos-por-dia-procurando-respostas). |
| 5 | **73%** | "73% dos devs já tiveram burnout." | Amostra de 29 mil devs. Ver [4.1](#41-burnout-em-algum-momento-da-carreira). |

**Recomendação:** para o título, usar o **53%** (é a dor central do Echo: alguém precisa de uma resposta e a pessoa não está). Para a linha de apoio, usar o **65%** (o que acontece quando alguém sai).

---

## 1. Esperar resposta de colegas e revisão de PR

### 1.1 Esperar resposta atrapalha o trabalho
- **Texto da fonte:** "Waiting on answers to questions often causes interruptions and disrupts my workflow." 16% strongly agree e 37% agree. O resumo da página diz: "53% agree or strongly agree that waiting on answers disrupts their workflow".
- **Fonte:** Stack Overflow Developer Survey 2024, profissionais. <https://survey.stackoverflow.co/2024/professional-developers>
- **Landing:** "53% dos devs dizem que esperar por respostas interrompe e atrapalha o trabalho."
- **Solidez:** alta. 28.747 respostas a essa pergunta, numa pesquisa aberta com 65 mil participantes. A Stack Overflow vende uma base de conhecimento interna (Stack Overflow for Teams), então tem interesse no tema, mas a pesquisa é a referência do setor. A pergunta fala de "respostas" em geral, não só de colegas: a frase da landing não deve dizer "colegas".

### 1.2 Quanto tempo um PR espera pela primeira revisão
- **Texto da fonte:** "pull requests created by AI agents wait 17.6 hours before review at the 75th percentile", contra "3.4 hours for unassisted pull requests". O relatório foi "built from more than 8.1 million pull requests".
- **Fonte:** LinearB, 2026 Software Engineering Benchmarks Report. <https://linearb.io/library/engineering-efficiency> (PDF: <https://linearb.io/resources/software-engineering-benchmarks-report>)
- **Landing:** "PRs abertos por agentes de IA esperam 17,6 horas pela primeira revisão (percentil 75), contra 3,4 horas dos outros."
- **Solidez:** média. Os dados são de uso real (8,1 milhões de PRs), mas é **pesquisa de fornecedor**: a LinearB vende ferramenta de métricas de engenharia. O número é do percentil 75, não da média: isso tem de aparecer na frase.

### 1.3 Revisão rápida melhora a entrega
- **Texto da fonte:** "Speeding up code reviews is one of the most effective paths to improving software delivery performance. Teams with faster code reviews have 50% higher software delivery performance."
- **Fonte:** Google Cloud DORA, Accelerate State of DevOps Report 2023. <https://dora.dev/research/2023/dora-report/2023-dora-accelerate-state-of-devops-report.pdf>
- **Landing:** "Times com revisão de código mais rápida têm desempenho de entrega 50% maior."
- **Solidez:** alta. Quase 3.000 profissionais em 2023, metodologia publicada. É correlação, não causa: o próprio relatório avisa que não adianta acelerar a revisão se o gargalo está em outro lugar.

### 1.4 Lembretes reduzem o tempo de PR parado
- **Texto da fonte (resumo do artigo):** num experimento controlado em 147 repositórios da Microsoft, o Nudge reduziu o tempo de resolução de 8.500 PRs atrasados em 60%, em comparação com PRs atrasados que não receberam lembrete.
- **Fonte:** Maddila et al., "Nudge: Accelerating Overdue Pull Requests Towards Completion", ACM TOSEM, 2022 (Microsoft Research e TU Delft). <https://arxiv.org/abs/2011.12468>
- **Landing:** "Na Microsoft, um lembrete na hora certa reduziu em 60% o tempo de PRs parados."
- **Solidez:** alta. Artigo revisado por pares com experimento controlado. Mede o efeito de lembretes, não a dor em si: serve melhor para a seção "como o Echo ajuda" do que para o título.

---

## 2. Interrupções e troca de contexto

### 2.1 Interrompido a cada 2 minutos
- **Texto da fonte:** "During the 9–5, employees are interrupted every 2 minutes by meetings, emails, or pings." e "Factor in activity outside of core work hours, and it adds up to 275 interruptions a day."
- **Fonte:** Microsoft Work Trend Index 2025, "The Year the Frontier Firm Is Born". <https://www.microsoft.com/en-us/worklab/work-trend-index/2025-the-year-the-frontier-firm-is-born>
- **Landing:** "No horário comercial, quem trabalha é interrompido a cada 2 minutos por reuniões, e-mails ou mensagens."
- **Solidez:** média-alta. Vem de sinais anônimos e agregados de uso do Microsoft 365 (até 15/2/2025), não de opinião. A nota de metodologia diz que o número é "Based on the top 20% of users by ping volume received": vale para os 20% mais interrompidos, não para todo mundo. A Microsoft vende ferramentas de produtividade com IA (Copilot). Não é específico de desenvolvedores. **Se usar no destaque, pôr a ressalva em nota de rodapé.**

### 2.2 Falta tempo de foco
- **Texto da fonte:** "68% of people say they don't have enough uninterrupted focus time during the workday."
- **Fonte:** Microsoft Work Trend Index 2023, "Will AI Fix Work?". <https://www.microsoft.com/en-us/worklab/work-trend-index/will-ai-fix-work>
- **Landing:** "68% das pessoas dizem que não têm tempo suficiente de foco sem interrupção."
- **Solidez:** média-alta. 31.000 trabalhadores em 31 países, pesquisa da Edelman Data x Intelligence (1/2 a 14/3/2023). Não é específico de devs e tem três anos.

### 2.3 Voltar ao código depois de uma pausa leva tempo
- **Texto da fonte:** "only 10% of the programming sessions have coding activity start in less than a minute" e "In about 30% of sessions, the edit lag is over 30 minutes."
- **Fonte:** Parnin e Rugaber, "Resumption Strategies for Interrupted Programming Tasks", ICPC 2009 (Georgia Tech). <https://sites.cc.gatech.edu/reverse/repository/resumptionstrategies.pdf>
- **Landing:** "Depois de uma pausa, só em 10% das vezes o programador volta a escrever código em menos de 1 minuto."
- **Solidez:** alta como ciência (dados de 10.000 sessões de 85 programadores, registradas pela IDE), mas o estudo é antigo. O "edit lag" mede o tempo até a primeira edição e inclui depuração, não só a recuperação da interrupção. **Evitar** o famoso "23 minutos para voltar ao foco": ele vem de entrevistas da pesquisadora Gloria Mark, não aparece nesse formato num artigo, e não consegui verificá-lo.

---

## 3. Fusos horários e trabalho distribuído

### 3.1 A maioria dos devs não está no escritório
- **Texto da fonte:** para "Which best describes your current work situation?": Hybrid 42%, Remote 38%, In-person 20%.
- **Fonte:** Stack Overflow Developer Survey 2024, trabalho. <https://survey.stackoverflow.co/2024/work>
- **Landing:** "80% dos devs trabalham remoto ou em modelo híbrido (38% + 42%)."
- **Solidez:** alta. 54.806 respostas. O "80%" é a soma de dois números publicados, então a frase deve mostrar a soma. Dado mais recente, mas com outra pergunta: no Stack Overflow 2026, "Only a small fraction (18%) of devs go into offices every day to work." (<https://stackoverflow.blog/2026/10/06/the-results-of-the-2026-developer-survey-are-here/>).

### 3.2 Reuniões depois das 20h por causa de fuso
- **Texto da fonte:** "And meetings after 8 p.m. are also up 16% YOY, driven by an increase in cross–time zone work."
- **Fonte:** Microsoft Work Trend Index 2025. <https://www.microsoft.com/en-us/worklab/work-trend-index/2025-the-year-the-frontier-firm-is-born>
- **Landing:** "Reuniões depois das 20h cresceram 16% em um ano, puxadas pelo trabalho entre fusos."
- **Solidez:** média-alta. Mesmos dados de uso do Microsoft 365 do item 2.1. Não é específico de devs.

### 3.3 Fuso como maior dificuldade do trabalho remoto
- **Texto da fonte:** na pergunta de maior dificuldade (uma resposta), "14% said working across time zones". Com várias respostas permitidas, "working across time zones (19 percent, down from 21 percent)".
- **Fonte:** Buffer, State of Remote Work 2023. <https://www.buffer.com/state-of-remote-work/2023>
- **Landing:** "Para 14% de quem trabalha remoto, trabalhar entre fusos é a maior dificuldade."
- **Solidez:** média. 3.000 trabalhadores remotos (10/10 a 28/11/2022), não só devs. O Buffer vende ferramenta de redes sociais e é empresa 100% remota. Número pequeno: melhor como dado de apoio do que como destaque.

---

## 4. Sobrecarga e burnout

### 4.1 Burnout em algum momento da carreira
- **Texto da fonte:** 73% dos desenvolvedores já tiveram burnout, definido como "emotional exhaustion and decreased motivation due to intense or difficult work". A mesma página diz que quem tirou mais de 2 semanas de férias tem 8 pontos percentuais a menos de chance de ter burnout.
- **Fonte:** JetBrains, State of Developer Ecosystem 2022, saúde mental. <https://www.jetbrains.com/lp/devecosystem-2022/mental-wellbeing/>
- **Landing:** "73% dos devs já tiveram burnout." E, para a seção de férias: "Devs que tiram mais de 2 semanas de férias têm menos burnout."
- **Solidez:** média-alta. 29.269 devs no total da pesquisa (a página de saúde mental não mostra quantos responderam a essa pergunta). Mede "já teve burnout alguma vez", autodeclarado, e não burnout atual. A JetBrains vende IDEs, mas não vende solução para burnout. **Atenção:** muitos sites atribuem esse número ao relatório de 2023. Ele é da pesquisa de 2022 (publicada em janeiro de 2023).

### 4.2 Burnout crítico agora
- **Texto da fonte:** 22% dos respondentes estão em nível "critical" de burnout, 24% moderado, 33% baixo e 21% saudável.
- **Fonte:** LeadDev, Engineering Leadership Report 2025 (slides "Beyond the headlines", LDX3 London 2025). <https://leaddev.com/wp-content/uploads/2025/06/LDX3-London-25-Scott-Carey-Beyond-the-headlines.pdf> e <https://leaddev.com/culture/engineering-burnout-rising-2025-layoffs-reshape-tech-industry>
- **Landing:** "1 em cada 5 pessoas de engenharia está em nível crítico de burnout (22%)."
- **Solidez:** média. Amostra menor (617 líderes e devs, março de 2025), mas usa o Maslach Burnout Inventory, que é o instrumento padrão. Conferi o número nas reportagens e no resumo dos slides, mas não abri o relatório completo, que exige cadastro.

### 4.3 Falta tempo ou energia
- **Texto da fonte:** "80% of the global workforce—both employees and leaders—say they're lacking enough time or energy to do their work."
- **Fonte:** Microsoft Work Trend Index 2025. <https://www.microsoft.com/en-us/worklab/work-trend-index/2025-the-year-the-frontier-firm-is-born>
- **Landing:** "80% das pessoas dizem que falta tempo ou energia para dar conta do trabalho."
- **Solidez:** média-alta. 31.000 trabalhadores em 31 países. Não é específico de devs. A Microsoft vende o Copilot como solução.

---

## 5. Conhecimento concentrado em poucas pessoas (bus factor)

### 5.1 Bus factor de projetos populares
- **Texto da fonte:** "Among others, we find that the majority of our target systems (65%) have TF <= 2." O truck factor é "the minimal number of developers that have to be hit by a truck (or quit) before a project is incapacitated".
- **Fonte:** Avelino, Passos, Hora e Valente (UFMG), "A Novel Approach for Estimating Truck Factors", ICPC 2016. <https://arxiv.org/abs/1604.06766>
- **Landing:** "Em 65% dos projetos populares do GitHub, bastam 2 pessoas saírem para o projeto travar."
- **Solidez:** alta. Artigo revisado por pares, com 133 sistemas populares do GitHub. Os desenvolvedores de 67 desses sistemas foram consultados, e em 84% das respostas válidas concordaram total ou parcialmente com as estimativas. Ressalva: são projetos de código aberto, não equipes de empresas. A landing deve dizer "projetos populares do GitHub". **Não confundir** com a versão de 2015 do mesmo grupo (preprint no PeerJ), que traz outros números: 46% com TF = 1 e 28% com TF = 2.

### 5.2 Silos de conhecimento travam o trabalho toda semana
- **Texto da fonte:** "30% of developers say knowledge silos impact their productivity ten or more times per week."
- **Fonte:** Stack Overflow Developer Survey 2024, profissionais. <https://survey.stackoverflow.co/2024/professional-developers>
- **Landing:** "Para 30% dos devs, silos de conhecimento atrapalham o trabalho 10 vezes ou mais por semana."
- **Solidez:** alta. 28.462 respostas. Mesmo interesse comercial da Stack Overflow citado no item 1.1.

### 5.3 A resposta está nas pessoas
- **Texto da fonte:** "The most trusted source of information is still the people you work with (72%)."
- **Fonte:** Stack Overflow Developer Survey 2026, conhecimento. <https://survey.stackoverflow.co/2026/knowledge>
- **Landing:** "Para 72% dos devs, as pessoas com quem trabalham são a fonte de informação mais confiável."
- **Solidez:** média-alta. Pesquisa de 2026 com 30.903 respostas válidas, mas a página não diz quantas pessoas responderam a essa pergunta. Bom gancho para o gêmeo digital: a resposta está na cabeça de alguém que pode não estar disponível.

---

## 6. Trabalho travado em férias e ausências

Não há pesquisa sólida e específica de desenvolvedores sobre trabalho travado por férias. O bus factor (5.1) é o dado mais forte para esse tema. Para férias em geral:

### 6.1 A maioria trabalha nas férias
- **Texto da fonte:** "Planned Workationers (29%)": "This group intentionally plans to work during their vacation." "Unplanned Workationers (43%)": "These employees start their vacations with the intention to disconnect but end up working anyway." Só 28% são "True Vacationers". Segundo a mesma pesquisa, quem trabalha nas férias tem 1,6 vez mais chance de ficar nervoso ao pedir folga por causa da carga de trabalho.
- **Fonte:** Perceptyx, "Research Finds Vanishing Vacations and Work That Follows Us Everywhere", agosto de 2024. <https://blog.perceptyx.com/research-finds-vanishing-vacations-and-work-that-follows-us-everywhere>
- **Landing:** "Só 28% das pessoas conseguem de fato se desligar nas férias."
- **Solidez:** média-baixa. Quase 3.000 funcionários, não só devs. **Pesquisa de fornecedor** (a Perceptyx vende pesquisas de clima). A metodologia não está detalhada no post. Usar como dado de apoio, não no destaque.

---

## 7. Tempo gasto procurando informação

### 7.1 Mais de 30 minutos por dia procurando respostas
- **Texto da fonte:** "61% of all respondents spend more than 30 minutes a day searching for answers or solutions to problems."
- **Fonte:** Stack Overflow Developer Survey 2024, profissionais. <https://survey.stackoverflow.co/2024/professional-developers>
- **Landing:** "61% dos devs passam mais de 30 minutos por dia procurando respostas."
- **Solidez:** alta. 28.911 respostas. Ressalva: as faixas do gráfico somam 63,8%, não 61%. Usar o 61% que a própria fonte escreve no texto, que também é o número mais conservador.

### 7.2 Procurar informação é o que mais desperdiça tempo dos devs
- **Texto da fonte:** "50% report losing 10+ hours per week, and 90% lose 6+ hours or more, largely due to organizational inefficiencies." Os maiores desperdícios são "finding information (services, docs, APIs), adapting new technology, and context switching between tools."
- **Fonte:** Atlassian, State of Developer Experience Report 2025. <https://www.atlassian.com/blog/developer/developer-experience-report-2025>
- **Landing:** "Metade dos devs perde 10 horas ou mais por semana com ineficiências, e procurar informação é a principal causa."
- **Solidez:** média. 3.500 devs e gestores em 6 países, sem datas de campo publicadas. **Pesquisa de fornecedor** (a Atlassian vende Jira e Confluence). O relatório de 2026 (cerca de 1.500 respondentes) mantém "finding information" como a principal fonte de atrito, mas o post público não traz porcentagem: <https://www.atlassian.com/blog/developer/developer-experience-report-2026>.

### 7.3 Tempo demais procurando informação
- **Texto da fonte:** "And 62% of survey respondents say they struggle with too much time spent searching for information in their workday."
- **Fonte:** Microsoft Work Trend Index 2023. <https://www.microsoft.com/en-us/worklab/work-trend-index/will-ai-fix-work>
- **Landing:** "62% das pessoas dizem que perdem tempo demais procurando informação."
- **Solidez:** média-alta. 31.000 trabalhadores, não só devs. Dado de 2023.

---

## Números a evitar

| Dado que circula | Problema |
|------------------|----------|
| "55% dos devs sofrem com a espera de resposta" | Não encontrei em nenhuma fonte. Usar o 53% do item 1.1. |
| "23 minutos para recuperar o foco depois de uma interrupção" | Vem de entrevistas da pesquisadora Gloria Mark, não do artigo dela. Não consegui verificar. |
| "83% dos devs têm burnout" | Atribuído à Haystack Analytics (2021), uma pesquisa de fornecedor. Não conferi a fonte original nem a amostra. Usar o 73% da JetBrains. |
| "73% de burnout, JetBrains 2023" | O número é real, mas da pesquisa de **2022**. |
| "Truck factor: 74% dos projetos têm TF de 1 ou 2" | Preprint de 2015. A versão revisada e publicada (ICPC 2016) diz 65%. |
| "55% sentem pressão para ficar disponíveis nas férias" | Enquete da NumberBarn, sem metodologia publicada. |
| "Devs passam metade do tempo esperando revisões, builds e testes" (GitHub 2023) | A pesquisa existe (500 devs nos EUA, com a Wakefield), mas não encontrei a porcentagem exata. Não usar sem conferir o relatório. |
