/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */
import { supabase } from '@/src/supabaseClient';
import { Session } from '@supabase/supabase-js';
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileJson,
  Home as HomeIcon,
  LoaderCircle,
  LogOut,
  Plus,
  Redo,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Undo,
  Upload,
  X,
} from 'lucide-react';
import React,
{
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import JSZip from 'jszip';

// --- UTILITY FUNCTIONS ---
function parseError(error: any) {
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') {
    const geminiErrorRegex = /{"error":\s*(.*)}/gm;
    const m = geminiErrorRegex.exec(error.message);
    try {
      if (m && m[1]) {
        // Handle cases where the JSON might be a string literal
        const jsonString = m[1].startsWith('"') && m[1].endsWith('"')
          ? JSON.parse(m[1])
          : m[1];
        const e = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        return e.error || e.message || error.message;
      }
    } catch (e) {
      return error.message;
    }
    return error.message;
  }
  return 'An unexpected error occurred.';
}


const base64ToBlob = (base64: string, mimeType: string): Blob => {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
};


const createNewPage = (id: string, name: string): Page => ({
  id,
  name,
  keywords: [],
  instructions: [],
  generatedImage: null,
  versions: [],
  contextPageIds: [],
});

// --- TYPES ---
interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface Page {
  id: string;
  name: string;
  keywords: string[];
  instructions: string[];
  generatedImage: string | null; // This will now be a URL to Supabase Storage
  versions: string[];
  contextPageIds: string[];
}

interface Project {
  id: string;
  user_id: string;
  name: string;
  pages: Page[];
  active_page_index: number;
  created_at: string;
  last_modified: string;
}

interface EditorHistory {
  past: EditorState[];
  present: EditorState;
  future: EditorState[];
}

interface EditorState {
  pages: Page[];
  activePageIndex: number;
}

interface Profile {
  id: string;
  name: string;
  has_completed_onboarding: boolean;
}

interface AppState {
  appStatus: 'loading' | 'auth' | 'dashboard' | 'editor';
  session: Session | null;
  profile: Profile | null;
  projects: Project[];
  activeProject: Project | null;
  editor: EditorHistory;
  isLoading: boolean;
  loadingMessage: string;
  errorMessage: string | null;
}

type AppAction =
  | { type: 'SET_SESSION'; payload: { session: Session | null; profile: Profile | null } }
  | { type: 'LOGOUT' }
  | { type: 'COMPLETE_ONBOARDING' }
  | { type: 'SET_PROJECTS'; payload: Project[] }
  | { type: 'SET_ACTIVE_PROJECT'; payload: Project | null }
  | { type: 'UPDATE_ACTIVE_PROJECT_IN_LIST'; payload: Project }
  | { type: 'DELETE_PROJECT_FROM_LIST'; payload: string }
  | { type: 'GO_TO_DASHBOARD' }
  | { type: 'SET_EDITOR_STATE'; payload: EditorState }
  | { type: 'UPDATE_EDITOR_STATE'; payload: Partial<EditorState> }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_LOADING'; payload: { isLoading: boolean; message?: string } }
  | { type: 'SET_ERROR'; payload: string | null };

// --- STATE MANAGEMENT (REDUCER & CONTEXT) ---

const initialState: AppState = {
  appStatus: 'loading',
  session: null,
  profile: null,
  projects: [],
  activeProject: null,
  editor: {
    past: [],
    present: {
      pages: [],
      activePageIndex: 0,
    },
    future: [],
  },
  isLoading: false,
  loadingMessage: '',
  errorMessage: null,
};

const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'SET_SESSION':
      return {
        ...state,
        session: action.payload.session,
        profile: action.payload.profile,
        appStatus: action.payload.session ? 'dashboard' : 'auth',
      };
    case 'LOGOUT':
      return {
        ...initialState,
        appStatus: 'auth',
      };
    case 'COMPLETE_ONBOARDING':
      if (!state.profile) return state;
      return {
        ...state,
        profile: { ...state.profile, has_completed_onboarding: true },
      };
    case 'SET_PROJECTS':
      return { ...state, projects: action.payload };
    case 'SET_ACTIVE_PROJECT': {
      const project = action.payload;
      if (!project) return { ...state, activeProject: null, appStatus: 'dashboard' };

      return {
        ...state,
        appStatus: 'editor',
        activeProject: project,
        editor: {
          past: [],
          present: {
            pages: project.pages,
            activePageIndex: project.active_page_index ?? 0,
          },
          future: [],
        }
      };
    }
    case 'UPDATE_ACTIVE_PROJECT_IN_LIST': {
      const updatedProject = action.payload;
      const newProjects = state.projects.map(p => p.id === updatedProject.id ? updatedProject : p);
      return { ...state, projects: newProjects };
    }
    case 'DELETE_PROJECT_FROM_LIST': {
      const projectId = action.payload;
      const newProjects = state.projects.filter(p => p.id !== projectId);
      return { ...state, projects: newProjects };
    }
    case 'GO_TO_DASHBOARD':
      return { ...state, appStatus: 'dashboard', activeProject: null };
    case 'SET_EDITOR_STATE':
      return {
        ...state,
        editor: {
          past: [],
          present: action.payload,
          future: [],
        },
      };
    case 'UPDATE_EDITOR_STATE': {
      const { present } = state.editor;
      // Poor man's deep equal
      if (
        JSON.stringify(present.pages) === JSON.stringify((action.payload as EditorState).pages) &&
        present.activePageIndex === (action.payload as EditorState).activePageIndex
      ) {
        return state;
      }
      return {
        ...state,
        editor: {
          past: [...state.editor.past, present],
          present: { ...present, ...action.payload },
          future: [],
        },
      };
    }
    case 'UNDO': {
      const { past, present, future } = state.editor;
      if (past.length === 0) return state;
      const previous = past[past.length - 1];
      const newPast = past.slice(0, past.length - 1);
      return {
        ...state,
        editor: {
          past: newPast,
          present: previous,
          future: [present, ...future],
        },
      };
    }
    case 'REDO': {
      const { past, present, future } = state.editor;
      if (future.length === 0) return state;
      const next = future[0];
      const newFuture = future.slice(1);
      return {
        ...state,
        editor: {
          past: [...past, present],
          present: next,
          future: newFuture,
        },
      };
    }
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload.isLoading,
        loadingMessage: action.payload.message || state.loadingMessage,
      };
    case 'SET_ERROR':
      return { ...state, errorMessage: action.payload };
    default:
      return state;
  }
};

const AppStateContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

const useAppContext = () => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};

const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return (
    <AppStateContext.Provider value={{ state, dispatch }}>
      {children}
    </AppStateContext.Provider>
  );
};

// --- MAIN APP COMPONENT ---

export default function Home() {
  return (
    <AppProvider>
      <App />
    </AppProvider>
  );
}

function App() {
  const { state, dispatch } = useAppContext();

  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      let profile = null;
      if (session) {
        const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        profile = data;
      }
      dispatch({ type: 'SET_SESSION', payload: { session, profile } });
    };
    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      let profile = null;
      if (session) {
        const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
        profile = data;
      }
      dispatch({ type: 'SET_SESSION', payload: { session, profile } });
    });

    return () => subscription.unsubscribe();
  }, [dispatch]);

  // Autosave effect
  useEffect(() => {
    if (state.appStatus === 'editor' && state.editor.past.length > 0 && state.activeProject) {
      const timer = setTimeout(async () => {
        const updatedProjectData = {
          pages: state.editor.present.pages,
          active_page_index: state.editor.present.activePageIndex,
          last_modified: new Date().toISOString(),
        };
        const { data, error } = await supabase
          .from('projects')
          .update(updatedProjectData)
          .eq('id', state.activeProject.id)
          .select()
          .single();

        if (error) {
          console.error('Autosave failed:', error);
          // Optionally dispatch an error to the user
        } else if (data) {
          dispatch({ type: 'UPDATE_ACTIVE_PROJECT_IN_LIST', payload: data });
        }

      }, 1000); // Debounce save
      return () => clearTimeout(timer);
    }
  }, [state.editor.present, state.appStatus, state.activeProject, dispatch]);

  // Keyboard shortcuts for Undo/Redo
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (state.appStatus !== 'editor') return;
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isCtrlOrCmd = isMac ? event.metaKey : event.ctrlKey;

      if (isCtrlOrCmd && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'REDO' : 'UNDO' });
      }
      if (isCtrlOrCmd && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'REDO' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.appStatus, dispatch]);

  const renderContent = () => {
    switch (state.appStatus) {
      case 'loading':
        return (
          <div className="min-h-screen notebook-paper-bg flex items-center justify-center">
            <LoaderCircle className="w-12 h-12 text-gray-700 animate-spin" />
          </div>
        );
      case 'auth':
        return <AuthScreen />;
      case 'dashboard':
        return <DashboardScreen />;
      case 'editor':
        return <EditorScreen />;
      default:
        return null;
    }
  };

  return (
    <>
      {renderContent()}
      {state.errorMessage && <ErrorModal message={state.errorMessage} />}
    </>
  );
}

// --- SCREEN COMPONENTS ---

function AuthScreen() {
  const { dispatch } = useAppContext();
  const [isLoginView, setIsLoginView] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const showError = (message: string) => {
    dispatch({ type: 'SET_ERROR', payload: message });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) {
      showError('Por favor, preencha todos os campos.');
      return;
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } }
    });
    if (error) showError(error.message);
    else alert('Cadastro realizado! Verifique seu e-mail para confirmação.');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) showError(error.message);
  };

  return (
    <div className="min-h-screen notebook-paper-bg flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-4xl sm:text-5xl font-bold mb-8 text-center font-mega text-gray-800">
          Criador Mental
        </h1>
        <div className="bg-white/90 p-8 border-2 border-gray-300 shadow-lg w-full">
          <h2 className="text-2xl font-bold text-center text-gray-700 mb-6">
            {isLoginView ? 'Login' : 'Cadastro'}
          </h2>
          <form onSubmit={isLoginView ? handleLogin : handleRegister}>
            <div className="space-y-4">
              {!isLoginView && (
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome"
                  className="w-full p-3 text-base border-2 border-gray-400 bg-white text-gray-800 focus:ring-2 focus:ring-gray-300 focus:outline-none transition-all font-mono"
                />
              )}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full p-3 text-base border-2 border-gray-400 bg-white text-gray-800 focus:ring-2 focus:ring-gray-300 focus:outline-none transition-all font-mono"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Sua senha"
                className="w-full p-3 text-base border-2 border-gray-400 bg-white text-gray-800 focus:ring-2 focus:ring-gray-300 focus:outline-none transition-all font-mono"
              />
            </div>
            <button
              type="submit"
              className="w-full p-3 mt-6 text-lg font-semibold text-white bg-gray-800 hover:bg-gray-700 transition-colors">
              {isLoginView ? 'Entrar' : 'Cadastrar'}
            </button>
          </form>
          <button
            onClick={() => setIsLoginView(!isLoginView)}
            className="w-full mt-4 text-sm text-center text-gray-600 hover:underline">
            {isLoginView
              ? 'Não tem uma conta? Cadastre-se'
              : 'Já tem uma conta? Faça login'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DashboardScreen() {
  const { state, dispatch } = useAppContext();
  const { profile, projects } = state;
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    const fetchProjects = async () => {
      if (!state.session) return;
      const { data, error } = await supabase.from('projects').select('*').order('last_modified', { ascending: false });
      if (error) {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to fetch projects.' });
      } else {
        dispatch({ type: 'SET_PROJECTS', payload: data });
      }
    };
    fetchProjects();
  }, [state.session, dispatch]);

  const handleCreateProject = async (projectName: string) => {
    const { data, error } = await supabase.from('projects').insert({
      name: projectName,
      pages: [createNewPage('master', 'Master')],
      active_page_index: 0,
    }).select().single();

    if (error) {
      dispatch({ type: 'SET_ERROR', payload: error.message });
    } else if (data) {
      dispatch({ type: 'SET_PROJECTS', payload: [...projects, data] });
      dispatch({ type: 'SET_ACTIVE_PROJECT', payload: data });
    }
  };

  const handleDeleteProject = async (project: Project) => {
    if (
      !window.confirm(
        `Tem certeza que deseja apagar o projeto "${project.name}"? Esta ação não pode ser desfeita.`,
      )
    )
      return;

    const { error } = await supabase.from('projects').delete().eq('id', project.id);
    if (error) {
      dispatch({ type: 'SET_ERROR', payload: error.message });
    } else {
      dispatch({ type: 'DELETE_PROJECT_FROM_LIST', payload: project.id });
    }
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newProjectName.trim()) {
      handleCreateProject(newProjectName.trim());
      setNewProjectName('');
      setShowCreateModal(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    dispatch({ type: 'LOGOUT' });
  }

  const handleCompleteOnboarding = async () => {
    if (!profile) return;
    const { error } = await supabase
      .from('profiles')
      .update({ has_completed_onboarding: true })
      .eq('id', profile.id);

    if (error) dispatch({ type: 'SET_ERROR', payload: error.message });
    else dispatch({ type: 'COMPLETE_ONBOARDING' });
  }

  return (
    <>
      <div className="min-h-screen notebook-paper-bg text-gray-900">
        <header className="bg-white/80 border-b-2 border-gray-300 backdrop-blur-sm sticky top-0 z-10">
          <div className="container mx-auto px-4 sm:px-6 py-3 flex justify-between items-center">
            <h1 className="text-xl sm:text-2xl font-bold font-mega text-gray-800">
              Dashboard
            </h1>
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-gray-800">
                  {profile?.name || 'Bem-vindo(a)'}
                </p>
                <p className="text-xs text-gray-600">{state.session?.user.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center justify-center gap-2 p-2 text-sm font-semibold bg-gray-600 text-white rounded-md hover:bg-gray-500 transition-colors"
                title="Sair">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 sm:px-6 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            <button
              onClick={() => setShowCreateModal(true)}
              className="aspect-[4/3] border-2 border-dashed border-gray-400 rounded-md flex flex-col items-center justify-center text-gray-600 hover:bg-white/50 hover:border-gray-600 hover:text-gray-800 transition-colors">
              <Plus className="w-12 h-12 mb-2" />
              <span className="font-semibold">Criar Novo Projeto</span>
            </button>

            {projects.map((project) => (
              <div
                key={project.id}
                className="group aspect-[4/3] bg-white/80 border-2 border-gray-300 rounded-md shadow-sm flex flex-col justify-between p-4 transition-all hover:shadow-lg hover:border-gray-400">
                <button
                  onClick={() => dispatch({ type: 'SET_ACTIVE_PROJECT', payload: project })}
                  className="text-left flex-grow">
                  <h3 className="font-bold text-lg text-gray-800 break-words">
                    {project.name}
                  </h3>
                </button>
                <div className="flex justify-between items-end mt-2">
                  <p className="text-xs text-gray-500">
                    Modificado:{' '}
                    {new Date(project.last_modified).toLocaleDateString()}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(project);
                    }}
                    className="p-1.5 rounded-full text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-600 transition-opacity"
                    title="Apagar Projeto">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
            <h3 className="text-xl font-bold text-gray-700 mb-4">
              Criar Novo Projeto
            </h3>
            <form onSubmit={handleCreateSubmit}>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Nome do projeto..."
                className="w-full p-3 text-base border-2 border-gray-300 bg-white text-gray-800 rounded-md shadow-sm focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all"
                required
                autoFocus
              />
              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors">
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-gray-800 rounded-md hover:bg-gray-700 transition-colors">
                  Criar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {profile && !profile.has_completed_onboarding && (
        <OnboardingModal
          onComplete={handleCompleteOnboarding}
        />
      )}
    </>
  );
}

function EditorScreen() {
  const { state, dispatch } = useAppContext();
  const {
    activeProject,
    editor,
    isLoading,
    loadingMessage,
  } = state;
  const { present } = editor;
  const { pages, activePageIndex } = present;
  const activePage = pages[activePageIndex];
  const canvasBackgroundImageRef = useRef<HTMLImageElement | null>(null);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const importJsonRef = useRef<HTMLInputElement | null>(null);
  const [newKeyword, setNewKeyword] = useState('');
  const [newInstruction, setNewInstruction] = useState('');


  // Local UI State
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash-image');
  const [focusedItems, setFocusedItems] = useState<{ keywords: number[]; instructions: number[] }>({ keywords: [], instructions: [] });
  const [isPageModalOpen, setIsPageModalOpen] = useState<boolean>(false);

  // Derived state
  const canUndo = editor.past.length > 0;
  const canRedo = editor.future.length > 0;

  // Effects
  useEffect(() => {
    if (activePage?.generatedImage && canvasRef.current) {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        canvasBackgroundImageRef.current = img;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = activePage.generatedImage;
    } else {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [activePage?.id, activePage?.generatedImage]);

  // Handlers
  const updatePage = (updates: Partial<Omit<Page, 'id'>>) => {
    const newPages = pages.map((page, index) =>
      index === activePageIndex ? { ...page, ...updates } : page,
    );
    dispatch({ type: 'UPDATE_EDITOR_STATE', payload: { pages: newPages } });
  };
  
  const handleAddItem = (type: 'keyword' | 'instruction') => {
    if (type === 'keyword' && newKeyword.trim()) {
      updatePage({ keywords: [...activePage.keywords, newKeyword.trim()] });
      setNewKeyword('');
    } else if (type === 'instruction' && newInstruction.trim()) {
      updatePage({ instructions: [...activePage.instructions, newInstruction.trim()] });
      setNewInstruction('');
    }
  };

  const handleDeleteItem = (type: 'keyword' | 'instruction', index: number) => {
    if (type === 'keyword') {
      const updatedKeywords = activePage.keywords.filter((_, i) => i !== index);
      updatePage({ keywords: updatedKeywords });
    } else if (type === 'instruction') {
      const updatedInstructions = activePage.instructions.filter((_, i) => i !== index);
      updatePage({ instructions: updatedInstructions });
    }
  };

  const generateMindMap = async (mode: 'evolve' | 'rethink') => {
    if (!activeProject) return;
    if (activePage.id !== 'master' && activePage.keywords.length === 0) {
      dispatch({
        type: 'SET_ERROR',
        payload:
          'Por favor, adicione pelo menos uma palavra-chave a esta página antes de gerar o desenho.',
      });
      return;
    }

    const loadingMessages = [
      'A IA está desenhando...',
      'Sintetizando conceitos...',
      'Buscando conexões visuais...',
      'Polindo os detalhes...',
      'Dando vida às ideias...',
      'Organizando o caos criativo...',
    ];
    dispatch({
      type: 'SET_LOADING',
      payload: {
        isLoading: true,
        message:
          loadingMessages[Math.floor(Math.random() * loadingMessages.length)],
      },
    });
    setFocusedItems({ keywords: [], instructions: [] });

    try {
      let drawingData: string;
      if (
        mode === 'evolve' &&
        activePage.generatedImage &&
        canvasRef.current
      ) {
        drawingData = canvasRef.current.toDataURL('image/png').split(',')[1];
      } else {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvasRef.current?.width || 960;
        tempCanvas.height = canvasRef.current?.height || 540;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) {
          dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
          return;
        }
        tempCtx.fillStyle = '#FFFFFF';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        drawingData = tempCanvas.toDataURL('image/png').split(',')[1];
      }

      let aiPrompt: string;

      if (activePage.id === 'master') {
        let masterContext =
          'YOUR TASK IS TO CREATE A MASTER MIND MAP. Synthesize all concepts from all the user\'s pages into one single, cohesive drawing. Identify and visualize the connections, overlaps, and high-level themes between them. The final drawing must be a unified "brain" of the entire project.';
        pages
          .filter((p) => p.id !== 'master')
          .forEach((page) => {
            if (page.keywords.length > 0) {
              masterContext += `\n\n- On page "${page.name
                }", the core concepts are: "${page.keywords.join(
                  ', ',
                )}". The instructions were: "${page.instructions.join('. ')}".`;
            }
          });
        aiPrompt = masterContext;
        if (mode === 'evolve') {
          aiPrompt +=
            '\n\nEvolve the previous master drawing with this complete context. Do not start from scratch.';
        }
      } else {
        const allKeywords = activePage.keywords.join(', ');
        const allInstructions = activePage.instructions.join('. ');

        aiPrompt = `GOLDEN RULE: YOU MUST REPRESENT 100% OF ALL KEYWORDS AND FOLLOW 100% OF ALL INSTRUCTIONS for the page "${activePage.name}". No concept can be ignored. Use simple icons, text labels, and arrows. Maintain the hand-drawn, minimalist style unless an instruction says otherwise.`;

        if (mode === 'evolve') {
          aiPrompt += `\n\nRULE 2: EVOLVE, DO NOT RESTART. Evolve the provided drawing for page "${activePage.name}". Integrate all keywords and instructions by modifying, adding to, or refining the existing visual elements.`;
        } else {
          aiPrompt += `\n\nRULE 2: START FRESH. Generate a completely new mind map for page "${activePage.name}" from a blank canvas, synthesizing all keywords and instructions.`;
        }

        const focusedKeywords = focusedItems.keywords.map(
          (i) => activePage.keywords[i],
        );
        const focusedInstructions = focusedItems.instructions.map(
          (i) => activePage.instructions[i],
        );

        if (focusedKeywords.length > 0 || focusedInstructions.length > 0) {
          aiPrompt += `\n\nCRITICAL FOCUS FOR THIS UPDATE: The user has specifically highlighted the following items. Give them maximum priority:`;
          if (focusedKeywords.length > 0) {
            aiPrompt += `\n- Focused Keywords: "${focusedKeywords.join(
              '", "',
            )}"`;
          }
          if (focusedInstructions.length > 0) {
            aiPrompt += `\n- Focused Instructions: "${focusedInstructions.join(
              '", "',
            )}"`;
          }
        }

        if (activePage.contextPageIds.length > 0) {
          let contextPrompt =
            '\n\nADDITIONAL CONTEXT: Use the following page(s) as inspiration. Find visual connections and synergies with the current page\'s concepts.';
          activePage.contextPageIds.forEach((pageId) => {
            const contextPage = pages.find((p) => p.id === pageId);
            if (contextPage) {
              contextPrompt += `\n- From page "${contextPage.name
                }": Core concepts are "${contextPage.keywords.join(
                  ', ',
                )}". Key instructions were: "${contextPage.instructions.join(
                  '. ',
                )}".`;
            }
          });
          aiPrompt += contextPrompt;
        }

        if (allInstructions) {
          aiPrompt += `\n\nOverall instructions to follow: "${allInstructions}".`;
        }
        aiPrompt += `\n\nAll concepts to include: "${allKeywords}".`;
      }


      // Invoke Supabase Edge Function
      const { data, error } = await supabase.functions.invoke('generate-image', {
        body: {
          imageData: drawingData,
          prompt: aiPrompt,
          mimeType: 'image/png',
        },
      });

      if (error) throw error;

      const { data: imageData, mimeType } = data;
      if (imageData) {
        const imageBlob = base64ToBlob(imageData, mimeType);
        const filePath = `${activeProject.user_id}/${activeProject.id}/${activePage.id}-${Date.now()}.png`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('project_images')
          .upload(filePath, imageBlob, { contentType: mimeType, upsert: true });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('project_images')
          .getPublicUrl(uploadData.path);

        updatePage({ generatedImage: publicUrl });
      } else {
        dispatch({
          type: 'SET_ERROR',
          payload: 'A IA não retornou uma imagem. Por favor, tente novamente.',
        });
      }
    } catch (error) {
      console.error('Error updating mind map:', error);
      dispatch({
        type: 'SET_ERROR',
        payload: parseError(error) || 'An unexpected error occurred.',
      });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
    }
  };

  const handleDownloadProject = async () => {
    const zip = new JSZip();
    const projectName =
      activeProject?.name.replace(/[^a-z0-9]/gi, '_') || 'projeto';

    for (const page of pages) {
      const folderName = page.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const pageFolder = zip.folder(folderName);
      if (page.generatedImage) {
        try {
          const response = await fetch(page.generatedImage);
          const blob = await response.blob();
          pageFolder.file('desenho_atual.png', blob);
        } catch (e) {
          console.error("Could not fetch image for zipping", e);
        }
      }
      let textContent = `# ${page.name}\n\n`;
      if (page.id === 'master') {
        textContent += `Esta é a página Master, que sintetiza todas as outras páginas.\n\n`;
      } else {
        textContent += `## Palavras-chave\n\n- ${page.keywords.join('\n- ') || '(Nenhuma)'
          }\n\n`;
        textContent += `## Instruções\n\n- ${page.instructions.join('\n- ') || '(Nenhuma)'
          }\n\n`;
      }
      pageFolder.file('ideias.md', textContent);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = `criador_mental_${projectName}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJson = () => {
    if (!activeProject) return;
    const exportableProject = {
      name: activeProject.name,
      pages: pages,
      activePageIndex: activePageIndex,
    };
    const jsonString = JSON.stringify(exportableProject, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${activeProject.name
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase()}_project.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeProject) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (
      !window.confirm(
        'Importar um arquivo substituirá o projeto ATUAL. Deseja continuar?',
      )
    ) {
      if (importJsonRef.current) importJsonRef.current.value = '';
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      dispatch({
        type: 'SET_EDITOR_STATE',
        payload: {
          pages: data.pages,
          activePageIndex: data.activePageIndex ?? 0,
        },
      });
      // This will trigger the autosave effect
    } catch (error) {
      dispatch({
        type: 'SET_ERROR',
        payload: 'Não foi possível ler ou analisar o arquivo JSON.',
      });
    } finally {
      if (importJsonRef.current) importJsonRef.current.value = '';
    }
  };

  if (!activeProject || !activePage) {
    return (
      <div className="min-h-screen notebook-paper-bg flex items-center justify-center">
        <LoaderCircle className="w-12 h-12 text-gray-700 animate-spin" />
        <p className="ml-4">Carregando projeto...</p>
      </div>
    );
  }

  const otherPages = pages.filter((p) => p.id !== 'master');

  return (
    <div className="min-h-screen notebook-paper-bg text-gray-900 flex flex-col justify-start items-center">
      <main className="container mx-auto px-3 sm:px-6 py-5 sm:py-10 pb-32 max-w-full w-full">
        <input
          type="file"
          ref={importJsonRef}
          onChange={handleImportJson}
          className="hidden"
          accept="application/json"
        />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-8">
          <aside className="lg:col-span-2 bg-white/80 p-4 border-2 border-gray-300 shadow-sm h-fit">
            <h2 className="text-xl font-bold mb-4 font-mega text-gray-700">
              Palavras-chave
            </h2>
            {activePage?.id === 'master' ? (
              // Master page view for keywords
              <p className="text-gray-500 text-sm">
                Esta é a página Master. As palavras-chave de outras páginas são usadas como contexto.
              </p>
            ) : (
              <>
                <form onSubmit={(e) => { e.preventDefault(); handleAddItem('keyword'); }} className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    placeholder="Adicionar ideia..."
                    className="flex-grow p-2 text-sm border-2 border-gray-300 bg-white rounded-md focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all"
                  />
                  <button type="submit" className="p-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 transition-colors"><Plus className="w-5 h-5" /></button>
                </form>
                {activePage.keywords.length > 0 ? (
                  <ul className="space-y-2">
                    {activePage.keywords.map((keyword, index) => (
                      <li
                        key={index}
                        className="flex justify-between items-center text-gray-800 font-mono text-sm p-2 border-l-4 border-yellow-400 bg-yellow-100/50 group transition-all">
                        <span className="break-words pr-2">{keyword}</span>
                        <button
                          onClick={() => handleDeleteItem('keyword', index)}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-500 text-sm italic">Nenhuma palavra-chave adicionada.</p>
                )}
              </>
            )}

            <h2 className="text-xl font-bold mt-6 mb-4 font-mega text-gray-700">
              Instruções
            </h2>
            {activePage?.id === 'master' ? (
              <p className="text-gray-500 text-sm">
                As instruções da página Master são geradas automaticamente.
              </p>
            ) : (
              <>
                <form onSubmit={(e) => { e.preventDefault(); handleAddItem('instruction'); }} className="flex gap-2 mb-4">
                  <input
                    type="text"
                    value={newInstruction}
                    onChange={(e) => setNewInstruction(e.target.value)}
                    placeholder="Adicionar instrução..."
                    className="flex-grow p-2 text-sm border-2 border-gray-300 bg-white rounded-md focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all"
                  />
                  <button type="submit" className="p-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 transition-colors"><Plus className="w-5 h-5" /></button>
                </form>
                {activePage.instructions.length > 0 ? (
                  <ul className="space-y-2">
                    {activePage.instructions.map((instruction, index) => (
                      <li
                        key={index}
                        className="flex justify-between items-center text-gray-800 font-mono text-sm p-2 border-l-4 border-blue-400 bg-blue-100/50 group transition-all">
                        <span className="break-words pr-2">{instruction}</span>
                        <button
                          onClick={() => handleDeleteItem('instruction', index)}
                          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-500 text-sm italic">Nenhuma instrução adicionada.</p>
                )}
              </>
            )}
          </aside>

          <div className="lg:col-span-7">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-2 sm:mb-6 gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold mb-0 leading-tight font-mega flex items-center gap-4">
                <button
                  onClick={() => dispatch({ type: 'GO_TO_DASHBOARD' })}
                  className="p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition-colors"
                  title="Voltar ao Dashboard">
                  <ArrowLeft className="w-5 h-5 text-gray-700" />
                </button>
                <span>
                  {activeProject.name || 'Criador Mental'}
                </span>
              </h1>
              <menu className="flex items-center bg-gray-300 rounded-full p-2 shadow-sm self-start sm:self-auto">
                <div className="relative mr-2">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="h-10 rounded-full bg-white pl-3 pr-8 text-sm text-gray-700 shadow-sm transition-all hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400 appearance-none border-2 border-white"
                    aria-label="Select Gemini Model">
                    <option value="gemini-2.5-flash-image">2.5 Flash</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
                    <ChevronDown className="w-5 h-5" />
                  </div>
                </div>
                <button
                  type="button"
                  title="Desfazer (Ctrl+Z)"
                  onClick={() => dispatch({ type: 'UNDO' })}
                  disabled={!canUndo}
                  className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm transition-all hover:bg-gray-50 hover:scale-110 mr-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100">
                  <Undo className="w-5 h-5 text-gray-700" />
                </button>
                <button
                  type="button"
                  title="Refazer (Ctrl+Y)"
                  onClick={() => dispatch({ type: 'REDO' })}
                  disabled={!canRedo}
                  className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm transition-all hover:bg-gray-50 hover:scale-110 mr-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100">
                  <Redo className="w-5 h-5 text-gray-700" />
                </button>
                <button
                  type="button"
                  title="Importar de JSON (substitui projeto atual)"
                  onClick={() => importJsonRef.current?.click()}
                  className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm transition-all hover:bg-gray-50 hover:scale-110 mr-2">
                  <Upload className="w-5 h-5 text-gray-700" />
                </button>
                <button
                  type="button"
                  title="Exportar para JSON (projeto atual)"
                  onClick={handleExportJson}
                  className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm transition-all hover:bg-gray-50 hover:scale-110 mr-2">
                  <FileJson className="w-5 h-5 text-gray-700" />
                </button>
                <button
                  type="button"
                  title="Fazer download do Projeto (ZIP)"
                  onClick={handleDownloadProject}
                  className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm transition-all hover:bg-gray-50 hover:scale-110">
                  <Download className="w-5 h-5 text-gray-700" />
                </button>
              </menu>
            </div>

            <div className="flex items-center border-b-2 border-black mb-1 overflow-x-auto">
              {/* Page tabs */}
            </div>

            <div className="relative w-full mb-6">
              <canvas
                ref={canvasRef}
                width={960}
                height={540}
                className="border-2 border-black w-full h-auto aspect-video bg-white/90"
              />
              {isLoading && (
                <div className="absolute inset-0 bg-white/70 flex flex-col items-center justify-center backdrop-blur-sm text-center p-4">
                  <LoaderCircle className="w-12 h-12 text-gray-700 animate-spin" />
                  <p className="mt-4 font-semibold text-gray-700">
                    {loadingMessage}
                  </p>
                </div>
              )}
            </div>

            {/* Versions, Prompt Input etc */}
          </div>
          <aside className="lg:col-span-3 bg-white/80 p-4 border-2 border-gray-300 shadow-sm flex flex-col max-h-[60vh] lg:max-h-[85vh]">
            <ChatPanel
              activePage={activePage}
              updatePage={updatePage}
              generateMindMap={generateMindMap}
            />
          </aside>
        </div>
      </main>

      {isPageModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          {/* Create Page Modal */}
        </div>
      )}
    </div>
  );
}

function ChatPanel({ activePage, updatePage, generateMindMap }: {
  activePage: Page;
  updatePage: (updates: Partial<Omit<Page, 'id'>>) => void;
  generateMindMap: (mode: 'evolve' | 'rethink') => void;
}) {
  const { dispatch } = useAppContext();
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userMessage: ChatMessage = { role: 'user', text: chatInput };
    const currentHistory = [...chatHistory, userMessage];
    setChatHistory(currentHistory);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('chat', {
        body: { history: currentHistory }
      });
      if (error) throw error;

      const modelMessage: ChatMessage = { role: 'model', text: data.response };
      setChatHistory(prev => [...prev, modelMessage]);
    } catch (error) {
      const errorMessage: ChatMessage = {
        role: 'model',
        text: 'Desculpe, ocorreu um erro.',
      };
      setChatHistory(prev => [...prev, errorMessage]);
      dispatch({ type: 'SET_ERROR', payload: parseError(error) })
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <>
      <h2 className="text-xl font-bold mb-4 font-mega text-gray-700 flex-shrink-0">
        Chat com IA
      </h2>
      <div ref={chatMessagesEndRef} className="flex-grow overflow-y-auto mb-4 pr-2 space-y-4">
        {chatHistory.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xs md:max-w-md lg:max-w-xs xl:max-w-sm p-3 rounded-lg ${msg.role === 'user' ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-800'}`}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm prose-p:my-0 prose-ul:my-1 prose-ol:my-1 break-words">
                        {msg.text}
                    </ReactMarkdown>
                </div>
            </div>
        ))}
        {isChatLoading && (
            <div className="flex justify-start">
                 <div className="p-3 rounded-lg bg-gray-200 text-gray-800">
                    <LoaderCircle className="w-5 h-5 animate-spin" />
                 </div>
            </div>
        )}
      </div>
      <div className="flex-shrink-0 mt-auto">
        <div className="grid grid-cols-3 gap-3 mb-3">
          <button
            onClick={() => { }}
            className="w-full flex items-center justify-center gap-2 p-3 text-sm font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-500 disabled:bg-gray-400 transition-colors">
            <Save className="w-5 h-5" />
            Salvar
          </button>
          <button
            onClick={() => generateMindMap('rethink')}
            disabled={isChatLoading}
            className="w-full flex items-center justify-center gap-2 p-3 text-sm font-semibold bg-gray-600 text-white rounded-md hover:bg-gray-500 disabled:bg-gray-400 transition-colors">
            <RefreshCw className="w-5 h-5" />
            Repensar
          </button>
          <button
            onClick={() => generateMindMap('evolve')}
            disabled={isChatLoading}
            className="w-full flex items-center justify-center gap-2 p-3 text-sm font-semibold bg-gray-800 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-400 transition-colors">
            <Sparkles className="w-5 h-5" />
            Atualizar
          </button>
        </div>
        <form onSubmit={handleSendChatMessage} className="w-full">
            <div className="relative">
                <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Converse com a IA..."
                    disabled={isChatLoading}
                    className="w-full p-3 pr-12 text-sm border-2 border-gray-300 bg-white rounded-md shadow-sm focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all disabled:bg-gray-100"
                />
            </div>
        </form>
      </div>
    </>
  );
}

function ErrorModal({ message }: { message: string }) {
  const { dispatch } = useAppContext();
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-xl font-bold text-red-600">Ocorreu um erro</h3>
          <button
            onClick={() => dispatch({ type: 'SET_ERROR', payload: null })}
            className="text-gray-400 hover:text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="font-medium text-gray-600">{parseError(message)}</p>
        <div className="flex justify-end mt-4">
          <button
            onClick={() => dispatch({ type: 'SET_ERROR', payload: null })}
            className="px-4 py-2 text-sm font-semibold text-white bg-gray-700 rounded-md hover:bg-gray-600 transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

const onboardingSteps = [
  {
    title: 'Bem-vindo ao Criador Mental!',
    content:
      'Vamos fazer um tour rápido para você começar a criar mapas mentais incríveis com a ajuda da IA.',
  },
  { title: 'Seu Painel de Projetos', content: "Esta é a sua área de trabalho. Todos os seus projetos aparecerão aqui. Para começar, clique em 'Criar Novo Projeto'." },
  { title: 'O Editor de Ideias', content: 'Dentro de um projeto, você transforma texto em imagens. Adicione palavras-chave e instruções para guiar a IA.' },
  { title: 'Atualizar vs. Repensar', content: "Use 'Atualizar' para evoluir seu desenho atual e 'Repensar' para que a IA crie uma nova versão do zero. Você está no controle!" },
  { title: 'Tudo Pronto!', content: 'Você está pronto para começar. Solte sua criatividade e veja suas ideias ganharem vida!' },
];

function OnboardingModal({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const currentStep = onboardingSteps[step];

  const handleNext = () => {
    if (step < onboardingSteps.length - 1) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 sm:p-8 text-center">
        <h3 className="text-2xl font-bold text-gray-800 mb-4">
          {currentStep.title}
        </h3>
        <p className="text-gray-600 mb-8">{currentStep.content}</p>
        <div className="flex justify-center items-center gap-3 mb-6">
          {onboardingSteps.map((_, index) => (
            <div
              key={index}
              className={`w-3 h-3 rounded-full transition-colors ${index === step ? 'bg-gray-800' : 'bg-gray-300'}`}></div>
          ))}
        </div>
        <div className="flex justify-between items-center gap-4">
          <button onClick={handleBack} disabled={step === 0} className="px-5 py-2 text-sm font-semibold text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            Voltar
          </button>
          <button onClick={handleNext} className="px-5 py-2 text-sm font-semibold text-white bg-gray-800 rounded-md hover:bg-gray-700 transition-colors">
            {step === onboardingSteps.length - 1 ? 'Concluir' : 'Próximo'}
          </button>
        </div>
      </div>
    </div>
  );
}