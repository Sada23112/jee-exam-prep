import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AppShell, AppErrorBoundary, NotFoundPage } from './app/App'
import { workspaceController } from './app/workspace-state'
import { AuthProvider } from './infrastructure/firebase/auth-context'
import { Dashboard } from './modules/question-bank/ui/Dashboard'
import { QuestionBank } from './modules/question-bank/ui/QuestionBank'
import { QuestionEditorRoute } from './modules/question-bank/ui/QuestionEditor'
import { QuestionDetail } from './modules/question-bank/ui/QuestionDetail'
import { CollectionsPage } from './modules/question-bank/ui/CollectionsPage'
import { PresetsPage } from './modules/exam-engine/ui/PresetsPage'
import { ExamLauncher } from './modules/exam-engine/ui/ExamLauncher'
import { CBTExamInterface } from './modules/exam-engine/ui/CBTExamInterface'
import { ExamResultsPage } from './modules/results/ui/ExamResultsPage'
import { QuestionImporterPage } from './modules/importer/ui/QuestionImporterPage'
import { SettingsPage } from './modules/settings/ui/SettingsPage'
import { BackupPage } from './infrastructure/backup-ui/BackupPage'
import 'katex/dist/katex.min.css'
import './styles.css'

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <NotFoundPage />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'bank', element: <QuestionBank /> },
      { path: 'bank/new', element: <QuestionEditorRoute /> },
      { path: 'bank/:id/edit', element: <QuestionEditorRoute /> },
      { path: 'bank/:id', element: <QuestionDetail /> },
      { path: 'collections', element: <CollectionsPage /> },
      { path: 'importer', element: <QuestionImporterPage /> },
      { path: 'presets', element: <PresetsPage /> },
      { path: 'exam/new', element: <ExamLauncher /> },
      { path: 'exam/:id/results', element: <ExamResultsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'backup', element: <BackupPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: 'exam/:id',
    element: <CBTExamInterface />,
    errorElement: <NotFoundPage />,
  },
])

const root = document.getElementById('root')
if (!root) throw new Error('Application root is missing.')
createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
void workspaceController.refresh()
