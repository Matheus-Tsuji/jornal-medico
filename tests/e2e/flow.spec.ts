import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'docs/screenshots';
mkdirSync(SHOTS, { recursive: true });

/** Login pelo fluxo real da UI; o código vem da caixa postal local de desenvolvimento. */
async function login(page: Page, email: string) {
  await page.goto('/entrar');
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
  await page.locator('#conteudo').getByRole('link', { name: 'Ler a análise completa' }).click();
  await expect(page.getByRole('heading', { name: 'Leitura rápida' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('0,64 a 0,95');
  await expect(page.getByRole('group', { name: /Gráfico de efeito/ })).toContainText('Desfecho composto cardiovascular'); // nome completo, sem reticências
  await expect(page.getByRole('group', { name: /Gráfico de efeito/ })).toBeVisible();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvo' })).toBeVisible();
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
});

test('visitante: entra sem e-mail e a barra de seções indica que há mais itens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/entrar');
  await page.getByRole('button', { name: 'Continuar sem e-mail' }).click();
  await expect(page).toHaveURL(/boas-vindas/);
  await page.getByRole('button', { name: 'Concluir depois' }).click();
  await expect(page).toHaveURL(/\/jornal$/);
  await expect(page.locator('summary', { hasText: 'Visitante' })).toBeVisible();
  const more = page.getByRole('button', { name: 'Ver mais seções' });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByRole('button', { name: 'Ver seções anteriores' })).toBeVisible();
  // visitante não assina sem e-mail
  await page.goto('/assinatura');
  await expect(page.getByRole('link', { name: 'Informar e-mail para assinar' }).first()).toBeVisible();
});

for (const width of [360, 390, 768, 1024, 1440]) {
  test(`responsivo sem overflow horizontal em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/jornal', '/artigos/demo-001', '/areas/clinica-medica', '/entrar']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} em ${width}px`).toBeLessThanOrEqual(0);
    }
    if (width === 390) {
      await page.goto('/jornal');
      await page.screenshot({ path: `${SHOTS}/jornal-mobile-390.png`, fullPage: true });
      await page.goto('/artigos/demo-001');
      await page.screenshot({ path: `${SHOTS}/artigo-mobile-390.png`, fullPage: true });
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
  expect(bg).toBe('rgb(22, 18, 15)');
});
