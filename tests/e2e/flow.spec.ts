import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true });

/** Login pelo fluxo real da UI; o código vem da caixa postal local de desenvolvimento. */
async function login(page: Page, email: string) {
  await page.goto('/entrar');
  await page.getByRole('button', { name: 'Entrar com código por e-mail' }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Receber código' }).click();
  await expect(page.getByLabel('Código')).toBeVisible();
  // Modo de teste: o código aparece na própria tela (sem provedor de e-mail).
  await expect(page.getByTestId('dev-code')).toHaveText(/^\d{6}$/);
  await page.getByRole('button', { name: 'Usar este código' }).click();
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('leitor: login, onboarding, edição, detalhe, salvar e persistência', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Os estudos que importam');
  await expect(page.getByText('Prévia com estudos fictícios de demonstração')).toBeVisible();

  await login(page, 'leitora-e2e@example.com');
  await expect(page).toHaveURL(/boas-vindas/);
  await page.getByRole('button', { name: 'Escolher meus interesses' }).click();
  await page.getByLabel('Diabetes', { exact: true }).check();
  await page.getByRole('button', { name: 'Revisar' }).click();
  await expect(page.getByText('Você vai acompanhar: Diabetes')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir a edição de hoje' }).click();

  await expect(page).toHaveURL(/\/jornal$/);
  await expect(page.getByText('Edição de demonstração.')).toBeVisible();
  const forYou = page.locator('section[aria-labelledby="para-voce"]');
  await expect(forYou.getByText('Você segue Diabetes').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/jornal-desktop.png`, fullPage: true });

  // Detalhe científico
  // A capa abre com a seleção pessoal (Para você); a manchete editorial é o demo-001.
  await expect(page.locator('#conteudo').getByRole('link', { name: 'Ler a análise completa' }).first()).toBeVisible();
  await page.goto('/artigos/demo-001');
  await expect(page.getByRole('heading', { name: 'Leitura rápida' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Nesta análise' })).toHaveCount(0); // índice removido a pedido (2026-11-19)
  const mainResult = page.getByRole('region', { name: 'Resultado geral' });
  await expect(mainResult.getByText('Desfecho', { exact: true })).toBeVisible();
  const metrics = mainResult.getByRole('table', { name: 'Dados do resultado geral' });
  await expect(metrics.getByRole('columnheader')).toHaveText(['HR', 'IC 95%', 'p-valor']);
  await expect(metrics).toContainText('0,64 a 0,95');
  const pico = page.getByRole('table', { name: /Pergunta do estudo no formato/ });
  await expect(pico.getByRole('rowheader', { name: 'População' })).toBeVisible();
  await expect(mainResult.getByRole('table')).toHaveCount(1);
  const limitations = page.getByRole('heading', { name: 'Limitações em destaque' });
  expect((await pico.boundingBox())!.y).toBeGreaterThan((await limitations.boundingBox())!.y);
  await page.getByRole('link', { name: 'Ver limitações, vieses e conflitos' }).click();
  await expect(page).toHaveURL(/#limitacoes$/);
  await expect(page.getByRole('heading', { name: 'Limitações, vieses e conflitos' })).toBeInViewport();
  await expect(page.locator('table.results-table')).toContainText('0,64 a 0,95');
  await expect(page.getByRole('group', { name: /Gráfico de efeito/ })).toContainText('Desfecho composto cardiovascular'); // nome completo, sem reticências
  await expect(page.getByRole('group', { name: /Gráfico de efeito/ })).toBeVisible();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvo' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/artigo-desktop.png`, fullPage: true });

  // Persistência após recarregar
  await page.goto('/salvos');
  await expect(page.getByRole('heading', { name: /meta pressórica intensiva/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /meta pressórica intensiva/ })).toBeVisible();

  // Preferências editáveis
  await page.goto('/configuracoes');
  await page.getByLabel('Insuficiência cardíaca').check();
  await page.getByRole('button', { name: 'Salvar interesses' }).click();
  await expect(page.getByText('Interesses salvos.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Insuficiência cardíaca')).toBeChecked();

  // Leitor não acessa o painel
  await page.goto('/admin');
  await expect(page.getByText('Acesso restrito à equipe editorial')).toBeVisible();
  const api = await page.request.get('/api/v1/admin/reviews');
  expect(api.status()).toBe(403);
});

test('editor: aprova análise pendente com justificativa e trilha de auditoria', async ({ page }) => {
  await login(page, 'editor-e2e@example.com');
  await page.goto('/admin/revisao');
  await page.getByRole('link', { name: 'Análise fictícia usada para demonstrar a revisão editorial' }).click();
  const approve = page.getByRole('button', { name: 'Aprovar e publicar análise' });
  await expect(approve).toBeDisabled(); // sem justificativa
  await page.getByLabel('Justificativa da decisão (obrigatória)').fill('Conferido no teste e2e (item fictício).');
  await approve.click();
  await expect(page.getByText('Esta versão não está em revisão')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Conferido no teste e2e (item fictício).' })).toBeVisible();
  await page.goto('/admin/auditoria');
  await expect(page.getByRole('cell', { name: 'review.approve' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/admin-auditoria.png` });

  await page.goto('/regulacao');
  await page.getByText('Cadastrar documento oficial (equipe editorial)', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Órgão', exact: true }).selectOption('digital');
  await page.getByLabel('Identificação (tipo, número e ano)').fill('DEMO-REG-001');
  await page.getByLabel('Título oficial').fill('DEMO — portaria fictícia de saúde digital');
  await page.getByLabel('Ementa ou trecho literal').fill('Documento fictício para teste de telemedicina; não é uma norma real.');
  await page.getByLabel('Link oficial HTTPS').fill('https://www.gov.br/saude/pt-br/demo-reg-001');
  await page.getByLabel('Conferi a fonte oficial', { exact: false }).check();
  await page.getByRole('button', { name: 'Salvar documento oficial', exact: true }).click();
  await expect(page.getByText('Documento cadastrado.', { exact: true })).toBeVisible();
  await page.getByLabel('Tecnologia em saúde', { exact: true }).check();
  await expect(page.getByRole('heading', { name: 'DEMO — portaria fictícia de saúde digital' })).toBeVisible();
  await page.getByLabel('Buscar por assunto ou identificação').fill('nenhum-resultado');
  await expect(page.getByText('Nenhum documento disponível com estes filtros', { exact: true })).toBeVisible();
});

test('conta com senha: cria, sai e entra de novo', async ({ page }) => {
  const email = `senha-${Date.now()}@example.com`;
  await page.goto('/entrar');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('senha-forte-1');
  await page.getByLabel('Repita a senha').fill('senha-forte-1');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page).toHaveURL(/boas-vindas/);
  await page.context().clearCookies();
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('senha-errada');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos.');
  await page.getByLabel('Senha', { exact: true }).fill('senha-forte-1');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/boas-vindas|jornal/);
});

test('visitante: entra sem e-mail e a barra de seções indica que há mais itens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/entrar');
  await page.getByRole('button', { name: 'Continuar sem conta' }).click();
  await expect(page).toHaveURL(/boas-vindas/);
  await page.getByRole('button', { name: 'Concluir depois' }).click();
  await expect(page).toHaveURL(/\/jornal$/);
  await expect(page.locator('.reader-card').getByText('Visitante', { exact: true })).toBeVisible();
  const sections = page.getByRole('navigation', { name: 'Seções' }).getByRole('link');
  await expect(sections.nth(0)).toHaveText('Hoje');
  await expect(sections.nth(1)).toHaveText('Congressos');
  await expect(sections.nth(2)).toHaveText('Clínica médica');
  const more = page.getByRole('button', { name: 'Ver mais seções' });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByRole('button', { name: 'Ver seções anteriores' })).toBeVisible();
  // visitante não assina sem e-mail
  await page.goto('/assinatura');
  await expect(page.getByRole('link', { name: 'Informar e-mail para assinar' }).first()).toBeVisible();
});

for (const width of [320, 360, 390, 768, 820, 1024, 1440]) {
  test(`responsivo sem overflow horizontal em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/jornal', '/artigos/demo-001', '/areas/clinica-medica', '/entrar', '/regulacao', '/publicacoes', '/congressos']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      if (path === '/jornal') {
        await expect(page.getByRole('heading', { name: 'Em alta' })).toBeVisible();
      }
      if (path === '/artigos/demo-001') {
        const details = page.locator('.publication-details');
        await expect(details).not.toHaveAttribute('open', '');
        await expect(page.getByRole('heading', { name: 'Limitações em destaque' })).toBeVisible();
        const table = page.locator('table.results-table');
        expect(await table.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
        await details.getByText('Sobre a publicação', { exact: false }).click();
        await expect(details).toHaveAttribute('open', '');
        await expect(details.getByText('DEMO-001', { exact: false })).toBeVisible();
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} em ${width}px`).toBeLessThanOrEqual(0);
    }
    if (width === 390 || width === 820) {
      await page.goto('/jornal');
      await page.screenshot({ path: `${SHOTS}/jornal-${width === 390 ? "mobile-390" : "tablet-820"}.png`, fullPage: true });
      await page.goto('/artigos/demo-001');
      await page.screenshot({ path: `${SHOTS}/artigo-${width === 390 ? "mobile-390" : "tablet-820"}.png`, fullPage: true });
      await page.goto('/regulacao');
      await page.screenshot({ path: `${SHOTS}/regulacao-${width}.png`, fullPage: true });

    }
  });
}

test('acessibilidade básica: link de pular, botões com nome, foco visível, tema escuro', async ({ page }) => {
  await page.goto('/jornal');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused();
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[href]')].filter((el) => !(el.getAttribute('aria-label') || el.textContent?.trim())).length,
  );
  expect(unnamed).toBe(0);
  const outline = await page.evaluate(() => {
    const a = document.querySelector('a.skip-link') as HTMLElement;
    a.focus();
    return getComputedStyle(a).outlineStyle;
  });
  expect(outline).not.toBe('none');
  // botão de tema: Automático → Claro → Escuro, e a escolha sobrevive ao recarregar
  const themeBtn = page.getByRole('button', { name: /^Tema:/ });
  await themeBtn.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await themeBtn.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: `${SHOTS}/jornal-escuro.png` });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(20, 18, 15)');
});

test('leitura ampliada no celular mantém resultados acessíveis', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('jm:fs', '1.25'));
  await page.goto('/artigos/demo-001');
  await expect(page.locator('table.results-table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test('barra de seções fica presa no topo sem mudar a altura do cabeçalho ao rolar', async ({ page }) => {
  await page.goto('/artigos/demo-001');
  await expect(page.locator('table.results-table')).toBeVisible();
  const h = () => page.evaluate(() => document.body.scrollHeight);
  const before = await h();
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(100);
  expect(await h()).toBe(before);
  const top = await page.getByRole('navigation', { name: 'Seções' }).evaluate((n) => n.getBoundingClientRect().top);
  expect(top).toBeLessThanOrEqual(1);
});
