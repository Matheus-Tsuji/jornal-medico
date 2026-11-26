import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/app.css';
import Layout from './components/Layout';
import Landing from './routes/Landing';
import Entrar from './routes/Entrar';
import BoasVindas from './routes/BoasVindas';
import Jornal from './routes/Jornal';
import Artigo from './routes/Artigo';
import Explorar from './routes/Explorar';
import { Edicoes, Historico, Salvos } from './routes/Acervo';
import Congressos from './routes/Congressos';
import Perfil from './routes/Perfil';
import PerfilPublico from './routes/PerfilPublico';
import Configuracoes from './routes/Configuracoes';
import { Assinatura, SandboxCheckout } from './routes/Assinatura';
import { CaixaDev, Metodologia, NaoEncontrado, Privacidade } from './routes/Paginas';
import { ApiError } from './lib/api';
import { Loading } from './components/ui';

const Monitor = lazy(() => import('./routes/Monitor'));
const Admin = lazy(() => import('./routes/Admin'));

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  {
    element: <Layout />,
    children: [
      { path: '/entrar', element: <Entrar /> },
      { path: '/auth/callback', element: <Entrar /> },
      { path: '/boas-vindas', element: <BoasVindas /> },
      { path: '/regulacao', element: <Suspense fallback={<Loading />}><Monitor key="regulation" kind="regulation" /></Suspense> },
      { path: '/publicacoes', element: <Suspense fallback={<Loading />}><Monitor key="publication" kind="publication" /></Suspense> },
      { path: '/jornal', element: <Jornal /> },
      { path: '/edicoes', element: <Edicoes /> },
      { path: '/edicoes/:date', element: <Jornal /> },
      { path: '/artigos/:slug', element: <Artigo /> },
      { path: '/areas/:area', element: <Explorar /> },
      { path: '/areas/:area/:subarea', element: <Explorar /> },
      { path: '/temas/:slug', element: <Explorar /> },
      { path: '/perfil', element: <Perfil /> },
      { path: '/perfil/:id', element: <PerfilPublico /> },
      { path: '/salvos', element: <Salvos /> },
      { path: '/historico', element: <Historico /> },
      { path: '/mais-lidos', element: <Navigate to="/jornal#em-alta" replace /> },
      { path: '/congressos', element: <Congressos /> },
      { path: '/configuracoes', element: <Configuracoes /> },
      { path: '/assinatura', element: <Assinatura /> },
      { path: '/assinatura/sandbox', element: <SandboxCheckout /> },
      { path: '/metodologia', element: <Metodologia /> },
      { path: '/privacidade', element: <Privacidade /> },
      { path: '/dev/caixa', element: <CaixaDev /> },
      { path: '/admin/*', element: <Suspense fallback={<Loading />}><Admin /></Suspense> },
      { path: '*', element: <NaoEncontrado /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
