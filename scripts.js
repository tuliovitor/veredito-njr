// ═══════════════════════════════════════════════════════════════
// VEREDITO NJR — Lógica principal
// ─── Configuração ───────────────────────────────────────────
// ⚠️ SUBSTITUA pelos valores reais em: Supabase → Settings → API
const SUPABASE_URL = 'https://luqvdlymdruncnnljtyu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1cXZkbHltZHJ1bmNubmxqdHl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNTY4MzIsImV4cCI6MjA5MDczMjgzMn0.rgVjCAQJYctMH8KEzYbyOEdRYluakd5MXDX5f6XRltc';
const STORAGE_KEY = 'veredito_voted';
const TABLE = 'votes';

// ─── Strings centralizadas ──────────────────────────────────
const STRINGS = {
  badge: '⚽ Veredito NJR',
  screen1Title: 'Qual é seu nome, torcedor(a)?',
  screen1Sub: 'Antes de votar, nos diz quem você é',
  screen1Placeholder: 'Ex: Tulio Vítor...',
  screen1Btn: 'Continuar →',
  screen2Sub: 'O Brasil precisa do camisa 10?',
  screen2BtnYes: 'Sim, levaria! 🇧🇷',
  screen2BtnNo: 'Não levaria',
  screen3aTitle: 'Sem ele, sem hexa!',
  screen3aSub: 'Eu também levaria com certeza!',
  screen3bSub: 'Veja o que a galera acha:',
  labelYes: 'Sim, levaria',
  labelNo: 'Não levaria',
  votesTotal: (n) =>
    `${n.toLocaleString('pt-BR')} torcedor${n !== 1 ? 'es' : ''} já votaram${n !== 1 ? '' : ''}`,
};

// ─── Estado da aplicação ────────────────────────────────────
const state = {
  userName: '',
  userVote: null, // 'sim' | 'nao' | null
  counts: { sim: 0, nao: 0 },
};

// ─── Inicialização do Supabase (lazy) ───────────────────────
// Getter preguiçoso: só inicializa quando as credenciais reais
// estiverem preenchidas e o CDN já tiver carregado
let _supabaseClient = null;

function getSupabase() {
  if (_supabaseClient) return _supabaseClient;

  // ✅ CORRIGIDO: checa se AINDA SÃO os placeholders originais
  // Se forem, o Supabase não é inicializado (modo offline)
  if (
    typeof window.supabase !== 'undefined' &&
    SUPABASE_URL !== 'YOUR_SUPABASE_URL' &&
    SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY'
  ) {
    _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('✅ Supabase inicializado com sucesso!');
  }

  return _supabaseClient;
}

// ─── Utilitário: Promise com timeout ────────────────────────
// Evita que a UI trave se o banco demorar para responder
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout após ${ms}ms`)), ms)
    ),
  ]);
}

// ─── Busca contagem de votos ────────────────────────────────
async function fetchCounts() {
  // Se Supabase não está disponível, retorna contagens atuais do estado
  if (!getSupabase()) {
    console.warn('⚠️ Supabase não disponível — usando contagens locais.');
    return state.counts;
  }

  try {
    const { data, error } = await withTimeout(
      getSupabase().from(TABLE).select('choice'),
      3000
    );

    if (error) {
      console.error('Erro ao buscar votos:', error);
      return state.counts;
    }

    // Conta manualmente cada opção
    let sim = 0;
    let nao = 0;

    if (data) {
      data.forEach((row) => {
        if (row.choice === 'sim') sim++;
        else if (row.choice === 'nao') nao++;
      });
    }

    state.counts.sim = sim;
    state.counts.nao = nao;

    console.log(`📊 Votos atualizados — Sim: ${sim} | Não: ${nao}`);
    return { sim, nao };
  } catch (err) {
    console.error('Erro inesperado ao buscar votos:', err);
    return state.counts;
  }
}

// ─── Envia voto para o banco ────────────────────────────────
async function submitVote(choice) {
  // Salva localmente PRIMEIRO para garantir a experiência do usuário
  // mesmo que o banco falhe
  localStorage.setItem(STORAGE_KEY, choice);
  state.userVote = choice;

  // Incrementa localmente para feedback imediato nas barras
  state.counts[choice]++;

  if (!getSupabase()) {
    console.warn('⚠️ Supabase não disponível — voto salvo apenas localmente.');
    return;
  }

  try {
    const { error } = await withTimeout(
      getSupabase().from(TABLE).insert([{ choice }]),
      3000
    );

    if (error) {
      console.error('Erro ao enviar voto:', error);
    } else {
      console.log(`✅ Voto '${choice}' registrado no banco!`);
    }
  } catch (err) {
    console.error('Erro inesperado ao enviar voto:', err);
  }
}

// ─── Calcula porcentagens ───────────────────────────────────
function getPercentages() {
  const total = state.counts.sim + state.counts.nao;

  // Empate técnico quando não há votos
  if (total === 0) return { sim: 50, nao: 50 };

  return {
    sim: Math.round((state.counts.sim / total) * 100),
    nao: Math.round((state.counts.nao / total) * 100),
  };
}

// ─── Assinatura de tempo real ───────────────────────────────
function subscribeRealtime() {
  if (!getSupabase()) {
    console.warn('⚠️ Realtime não disponível — Supabase não inicializado.');
    return;
  }

  try {
    getSupabase()
      .channel('votes-channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: TABLE },
        async (payload) => {
          console.log('🔴 Novo voto em tempo real recebido:', payload);
          await fetchCounts();
          renderStats();
        }
      )
      .subscribe((status) => {
        console.log('📡 Status do canal realtime:', status);
      });
  } catch (err) {
    console.error('Erro ao assinar realtime:', err);
  }
}

// ─── Atualiza barras e valores de estatísticas ──────────────
function renderStats() {
  const barYes = document.querySelector('.bar-fill-yes');
  const barNo = document.querySelector('.bar-fill-no');

  // Se as barras não existem no DOM, a tela de stats não está ativa
  if (!barYes || !barNo) return;

  const pct = getPercentages();
  const total = state.counts.sim + state.counts.nao;

  // Atualiza valores percentuais nos labels
  const valueYes = document.querySelector('.stat-value-yes');
  const valueNo = document.querySelector('.stat-value-no');
  if (valueYes) valueYes.textContent = `${pct.sim}%`;
  if (valueNo) valueNo.textContent = `${pct.nao}%`;

  // Atualiza total de votos
  const votesTotal = document.querySelector('.votes-total');
  if (votesTotal) votesTotal.textContent = STRINGS.votesTotal(total);

  // Delay de 10ms necessário para a transição CSS animar do 0% ao valor real
  setTimeout(() => {
    barYes.style.width = `${pct.sim}%`;
    barNo.style.width = `${pct.nao}%`;
  }, 10);
}

// ─── Transição entre telas ──────────────────────────────────
function transitionTo(renderFn) {
  const container = document.getElementById('screen-container');

  // Animação de saída
  container.classList.add('screen-exit');

  setTimeout(() => {
    container.innerHTML = '';
    container.classList.remove('screen-exit');

    // Renderiza o novo conteúdo
    renderFn();

    // Animação de entrada
    container.classList.add('screen-enter');

    setTimeout(() => {
      container.classList.remove('screen-enter');
    }, 350);
  }, 200);
}

// ─── Tela 1 — Nome do torcedor ──────────────────────────────
function renderScreen1() {
  const container = document.getElementById('screen-container');
  const existing = document.getElementById('js-fallback');

  if (existing) {
    // Fallback HTML já está no DOM — apenas conecta os eventos
    const input = document.getElementById('name-input');
    const btn = document.getElementById('btn-continue');

    if (input && btn) {
      input.addEventListener('input', () => {
        btn.disabled = input.value.trim().length === 0;
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim().length > 0) {
          state.userName = input.value.trim();
          transitionTo(renderScreen2);
        }
      });
      btn.addEventListener('click', () => {
        state.userName = input.value.trim();
        transitionTo(renderScreen2);
      });
      input.focus();
      return; // Não cria novos elementos
    }
  }

  // Fallback não encontrado — cria via JS normalmente
  container.innerHTML = '';

  // Título principal (h1 — usado apenas uma vez na página)
  const title = document.createElement('h1');
  title.className = 'title-display';
  title.textContent = STRINGS.screen1Title;

  // Subtítulo
  const sub = document.createElement('p');
  sub.className = 'subtitle';
  sub.textContent = STRINGS.screen1Sub;

  // Campo de texto
  const input = document.createElement('input');
  input.className = 'input-field';
  input.type = 'text';
  input.id = 'name-input';
  input.maxLength = 32;
  input.autocomplete = 'off';
  input.placeholder = STRINGS.screen1Placeholder;

  // Botão continuar
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary';
  btn.id = 'btn-continue';
  btn.disabled = true;
  btn.textContent = STRINGS.screen1Btn;

  container.appendChild(title);
  container.appendChild(sub);
  container.appendChild(input);
  container.appendChild(btn);

  // Foco automático no campo
  input.focus();

  // Habilita/desabilita botão conforme digitação
  input.addEventListener('input', () => {
    btn.disabled = input.value.trim().length === 0;
  });

  // Permite submissão via tecla Enter
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && input.value.trim().length > 0) {
      state.userName = input.value.trim();
      transitionTo(renderScreen2);
    }
  });

  // Clique no botão
  btn.addEventListener('click', () => {
    state.userName = input.value.trim();
    transitionTo(renderScreen2);
  });
}

// ─── Tela 2 — Pergunta de votação ──────────────────────────
function renderScreen2() {
  const container = document.getElementById('screen-container');
  container.innerHTML = '';

  // Título dinâmico com nome destacado
  // Usa DOM seguro (sem innerHTML) para o nome do usuário — previne XSS
  const title = document.createElement('h2');
  title.className = 'title-body';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'name-highlight';
  nameSpan.textContent = state.userName; // textContent = seguro contra XSS

  title.appendChild(document.createTextNode('Fala, '));
  title.appendChild(nameSpan);
  title.appendChild(document.createTextNode(' — levaria o Neymar para a Copa?'));

  // Subtítulo
  const sub = document.createElement('p');
  sub.className = 'subtitle';
  sub.textContent = STRINGS.screen2Sub;

  // Botão Sim
  const btnYes = document.createElement('button');
  btnYes.className = 'btn btn-yes';
  btnYes.id = 'btn-yes';
  btnYes.textContent = STRINGS.screen2BtnYes;

  // Botão Não
  const btnNo = document.createElement('button');
  btnNo.className = 'btn btn-no';
  btnNo.id = 'btn-no';
  btnNo.textContent = STRINGS.screen2BtnNo;

  container.appendChild(title);
  container.appendChild(sub);
  container.appendChild(btnYes);
  container.appendChild(btnNo);

  // Flag para prevenir duplo envio
  let submitted = false;

  btnYes.addEventListener('click', async () => {
    if (submitted) return;
    submitted = true;
    btnYes.disabled = true;
    btnNo.disabled = true;

    await submitVote('sim');
    await fetchCounts();
    transitionTo(renderScreen3a);
  });

  btnNo.addEventListener('click', async () => {
    if (submitted) return;
    submitted = true;
    btnYes.disabled = true;
    btnNo.disabled = true;

    await submitVote('nao');
    await fetchCounts();
    transitionTo(renderScreen3b);
  });
}

// ─── HTML das estatísticas (reutilizado nas telas 3a e 3b) ──
function renderStatsHTML() {
  const pct = getPercentages();
  const total = state.counts.sim + state.counts.nao;

  return `
    <div class="stat-row">
      <span class="stat-label">${STRINGS.labelYes}</span>
      <span class="stat-value-yes">${pct.sim}%</span>
    </div>
    <div class="bar-track">
      <div class="bar-fill bar-fill-yes" style="width: 0%"></div>
    </div>
    <div class="stat-row">
      <span class="stat-label">${STRINGS.labelNo}</span>
      <span class="stat-value-no">${pct.nao}%</span>
    </div>
    <div class="bar-track">
      <div class="bar-fill bar-fill-no" style="width: 0%"></div>
    </div>
    <p class="votes-total">${STRINGS.votesTotal(total)}</p>
  `;
}

// ─── Tela 3a — Votou SIM (celebração) ──────────────────────
function renderScreen3a() {
  const container = document.getElementById('screen-container');
  container.innerHTML = '';

  // Caixa de celebração animada
  const celebrationBox = document.createElement('div');
  celebrationBox.className = 'celebration-box';
  celebrationBox.innerHTML = `
    <span class="celebration-emoji">⚽</span>
    <p class="celebration-title">${STRINGS.screen3aTitle}</p>
    <p class="celebration-sub">${STRINGS.screen3aSub}</p>
  `;

  // Linha divisória
  const divider = document.createElement('hr');
  divider.className = 'divider';

  // Estatísticas
  const statsWrapper = document.createElement('div');
  statsWrapper.innerHTML = renderStatsHTML();

  container.appendChild(celebrationBox);
  container.appendChild(divider);
  container.appendChild(statsWrapper);

  // Aciona animação das barras após inserção no DOM
  setTimeout(() => {
    renderStats();
  }, 10);
}

// ─── Tela 3b — Votou NÃO (resultado) ───────────────────────
function renderScreen3b() {
  const container = document.getElementById('screen-container');
  container.innerHTML = '';

  // Título com nome destacado (DOM seguro — sem innerHTML para o nome)
  const title = document.createElement('p');
  title.className = 'title-body';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'name-highlight';
  nameSpan.textContent = state.userName; // textContent = seguro contra XSS

  title.appendChild(document.createTextNode('O torcedor falou, '));
  title.appendChild(nameSpan);
  title.appendChild(document.createTextNode('.'));

  // Subtítulo
  const sub = document.createElement('p');
  sub.className = 'subtitle';
  sub.textContent = STRINGS.screen3bSub;

  // Estatísticas
  const statsWrapper = document.createElement('div');
  statsWrapper.innerHTML = renderStatsHTML();

  container.appendChild(title);
  container.appendChild(sub);
  container.appendChild(statsWrapper);

  // Aciona animação das barras após inserção no DOM
  setTimeout(() => {
    renderStats();
  }, 10);
}

// ─── Inicialização ──────────────────────────────────────────
async function init() {
  console.log('🚀 Veredito NJR iniciando...');

  // 1. Renderiza a tela imediatamente — sem esperar o banco
  //    O usuário nunca vê o card vazio
  const previousVote = localStorage.getItem(STORAGE_KEY);

  if (previousVote) {
    // Usuário já votou — vai direto para o resultado
    state.userVote = previousVote;
    state.userName = 'Torcedor(a)';
    previousVote === 'sim' ? renderScreen3a() : renderScreen3b();
    console.log(`ℹ️ Voto anterior detectado: '${previousVote}' — exibindo resultado.`);
  } else {
    // Usuário novo — começa pelo nome
    renderScreen1();
  }

  // 2. Busca contagens em background — não bloqueia a UI
  try {
    await fetchCounts();
    renderStats(); // Atualiza barras se a tela de stats já estiver ativa
  } catch (err) {
    console.error('Erro ao buscar contagens iniciais:', err);
  }

  // 3. Liga o canal de tempo real em background
  try {
    subscribeRealtime();
  } catch (err) {
    console.error('Erro ao iniciar realtime:', err);
  }
}

// Aguarda o DOM estar pronto antes de iniciar
document.addEventListener('DOMContentLoaded', init);
