/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */
import {Chat, Content, GoogleGenAI, Modality, Type} from '@google/genai';
import {
  BotMessageSquare,
  ChevronDown,
  Download,
  FileJson,
  LoaderCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  SendHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import React, {useEffect, useRef, useState} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import JSZip from 'jszip';

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

function parseError(error: string) {
  const regex = /{"error":(.*)}/gm;
  const m = regex.exec(error);
  try {
    const e = m[1];
    const err = JSON.parse(e);
    return err.message || error;
  } catch (e) {
    return error;
  }
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface Page {
  id: string;
  name: string;
  keywords: string[];
  instructions: string[];
  generatedImage: string | null;
  versions: string[];
  contextPageIds: string[]; // To store IDs of pages used as context
  backgroundImageRef: React.MutableRefObject<HTMLImageElement | null>;
}

// Helper to convert file to base64
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);

  const createNewPage = (id: string, name: string): Page => ({
    id,
    name,
    keywords: [],
    instructions: [],
    generatedImage: null,
    versions: [],
    contextPageIds: [],
    backgroundImageRef: {current: null},
  });

  const [pages, setPages] = useState<Page[]>([
    createNewPage('master', 'Master'),
  ]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);

  const [prompt, setPrompt] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedModel, setSelectedModel] =
    useState<string>('gemini-2.5-flash-image');
  const [focusedItems, setFocusedItems] = useState<{
    keywords: number[];
    instructions: number[];
  }>({keywords: [], instructions: []});
  const [isPageModalOpen, setIsPageModalOpen] = useState<boolean>(false);
  const [newPageName, setNewPageName] = useState<string>('');

  // Chat state
  const [chat, setChat] = useState<Chat | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const [isProcessingImage, setIsProcessingImage] = useState<boolean>(false);

  const activePage = pages[activePageIndex];

  // Initialize chat session
  useEffect(() => {
    if (!activePage) return;

    let systemInstruction: string;
    if (activePage.id === 'master') {
      systemInstruction = `You are a creative AI assistant helping a user on their "Master" mind map page. This page is special: it synthesizes all other pages into a single, cohesive overview.
Your role is to discuss the high-level connections, potential synergies, and overarching themes between the user's different ideas.
The user will click "Atualizar" or "Repensar" on this Master page to trigger the AI to draw this synthesis.
You CANNOT draw or update the mind map yourself.`;
    } else {
      const keywordsString =
        activePage.keywords.length > 0
          ? activePage.keywords.join(', ')
          : 'nenhuma ainda';
      const instructionsString =
        activePage.instructions.length > 0
          ? activePage.instructions.join('; ')
          : 'nenhuma ainda';
      systemInstruction = `You are a creative AI assistant helping a user build a mind map on a page named "${activePage.name}".
The current keywords for THIS PAGE are: ${keywordsString}.
The current instructions for THIS PAGE are: ${instructionsString}.
Your role is purely conversational. Discuss ideas, suggest connections, or brainstorm new ones for THIS PAGE.
The user has "Atualizar Desenho" (evolve) and "Repensar" (rethink) buttons. They can also click on keywords/instructions to focus the AI's attention.
You CANNOT draw or update the mind map yourself. The user will click a separate button to trigger the image generation AI.`;
    }

    const newChat = ai.chats.create({
      model: 'gemini-2.5-flash',
      config: {systemInstruction},
    });
    setChat(newChat);
    setChatHistory([]); // Clear chat history when page changes
  }, [activePage]); // Re-initialize chat if active page changes

  // Scroll to bottom of chat history when new messages are added
  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [chatHistory]);

  // Redraw canvas when active page changes or its image is updated
  useEffect(() => {
    if (activePage?.generatedImage && canvasRef.current) {
      const img = new window.Image();
      img.onload = () => {
        activePage.backgroundImageRef.current = img;
        drawImageToCanvas(
          activePage.backgroundImageRef.current,
          activePage.generatedImage,
        );
      };
      img.src = activePage.generatedImage;
    } else {
      initializeCanvas();
    }
  }, [activePage?.id, activePage?.generatedImage]);

  const initializeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };

  const drawImageToCanvas = (
    image: HTMLImageElement | null,
    imageSrc: string | null,
  ) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (image && imageSrc) {
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
  };

  const clearProject = () => {
    const newPages = [createNewPage('master', 'Master')];
    setPages(newPages);
    setActivePageIndex(0);
    setFocusedItems({keywords: [], instructions: []});
    setChatHistory([]);
  };

  const generateMindMap = async (mode: 'evolve' | 'rethink') => {
    if (activePage.id !== 'master' && activePage.keywords.length === 0) {
      setErrorMessage(
        'Por favor, adicione pelo menos uma palavra-chave a esta página antes de gerar o desenho.',
      );
      setShowErrorModal(true);
      return;
    }
    setIsLoading(true);
    setFocusedItems({keywords: [], instructions: []}); // Reset focus after use

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
              masterContext += `\n\n- On page "${
                page.name
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
        // Regular page logic
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

        // Add context from other pages
        if (activePage.contextPageIds.length > 0) {
          let contextPrompt =
            '\n\nADDITIONAL CONTEXT: Use the following page(s) as inspiration. Find visual connections and synergies with the current page\'s concepts.';
          activePage.contextPageIds.forEach((pageId) => {
            const contextPage = pages.find((p) => p.id === pageId);
            if (contextPage) {
              contextPrompt += `\n- From page "${
                contextPage.name
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

      const contents: Content[] = [
        {
          role: 'user',
          parts: [
            {inlineData: {data: drawingData, mimeType: 'image/png'}},
            {text: aiPrompt},
          ],
        },
      ];

      const response = await ai.models.generateContent({
        model: selectedModel,
        contents,
        config: {responseModalities: [Modality.IMAGE]},
      });

      const imageData = response.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData,
      )?.inlineData?.data;

      if (imageData) {
        const imageUrl = `data:image/png;base64,${imageData}`;
        setPages((prevPages) =>
          prevPages.map((page, index) =>
            index === activePageIndex ? {...page, generatedImage: imageUrl} : page,
          ),
        );
      } else {
        setErrorMessage(
          'A IA não retornou uma imagem. Por favor, tente novamente.',
        );
        setShowErrorModal(true);
      }
    } catch (error) {
      console.error('Error updating mind map:', error);
      setErrorMessage(
        parseError((error as Error).message) ||
          'An unexpected error occurred.',
      );
      setShowErrorModal(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadProject = async () => {
    const zip = new JSZip();

    for (const page of pages) {
      const folderName = page.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const pageFolder = zip.folder(folderName);

      if (page.generatedImage) {
        const base64Data = page.generatedImage.split(',')[1];
        pageFolder.file('desenho_atual.png', base64Data, {base64: true});
      }

      if (page.versions && page.versions.length > 0) {
        const versionsFolder = pageFolder.folder('versoes');
        page.versions.forEach((version, index) => {
          const base64Data = version.split(',')[1];
          versionsFolder.file(`versao_${index + 1}.png`, base64Data, {
            base64: true,
          });
        });
      }

      let textContent = `# ${page.name}\n\n`;
      if (page.id === 'master') {
        textContent += `Esta é a página Master, que sintetiza todas as outras páginas.\n\n`;
      } else {
        if (page.keywords.length > 0) {
          textContent += `## Palavras-chave\n\n- ${page.keywords.join(
            '\n- ',
          )}\n\n`;
        } else {
          textContent += `## Palavras-chave\n\n(Nenhuma)\n\n`;
        }
        if (page.instructions.length > 0) {
          textContent += `## Instruções\n\n- ${page.instructions.join(
            '\n- ',
          )}\n\n`;
        } else {
          textContent += `## Instruções\n\n(Nenhuma)\n\n`;
        }
      }
      pageFolder.file('ideias.md', textContent);
    }

    const zipBlob = await zip.generateAsync({type: 'blob'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = 'gemini_mind_map_projeto.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJson = () => {
    const exportablePages = pages.map(({backgroundImageRef, ...rest}) => rest);
    const jsonString = JSON.stringify({pages: exportablePages}, null, 2);
    const blob = new Blob([jsonString], {type: 'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'gemini_mind_map_project.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const updateActivePage = (updates: Partial<Page>) => {
    setPages((prevPages) =>
      prevPages.map((page, index) =>
        index === activePageIndex ? {...page, ...updates} : page,
      ),
    );
  };

  const handlePromptSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activePage.id === 'master') return;
    const value = prompt.trim();
    if (!value) return;

    if (value.toLowerCase().startsWith('i:')) {
      const instruction = value.substring(2).trim();
      if (instruction) {
        updateActivePage({
          instructions: [...activePage.instructions, instruction],
        });
      }
    } else {
      const newKeywords = value
        .split(';')
        .map((k) => k.trim())
        .filter(Boolean);
      if (newKeywords.length > 0) {
        updateActivePage({keywords: [...activePage.keywords, ...newKeywords]});
      }
    }
    setPrompt('');
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !chat) return;

    const userMessage: ChatMessage = {role: 'user', text: chatInput};
    setChatHistory((prev) => [...prev, userMessage]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const response = await chat.sendMessage({message: chatInput});
      const modelMessage: ChatMessage = {role: 'model', text: response.text};
      setChatHistory((prev) => [...prev, modelMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        role: 'model',
        text: 'Desculpe, ocorreu um erro ao me comunicar. Tente novamente.',
      };
      setChatHistory((prev) => [...prev, errorMessage]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleImageInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file || activePage.id === 'master') return;

    let mimeType = file.type;
    // Fallback for browsers that don't provide a MIME type
    if (!mimeType) {
      const fileName = file.name.toLowerCase();
      if (fileName.endsWith('.png')) {
        mimeType = 'image/png';
      } else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
        mimeType = 'image/jpeg';
      } else if (fileName.endsWith('.webp')) {
        mimeType = 'image/webp';
      } else if (fileName.endsWith('.gif')) {
        mimeType = 'image/gif';
      } else {
        setChatHistory((prev) => [
          ...prev,
          {
            role: 'model',
            text: 'Não foi possível determinar o tipo da imagem. Por favor, use um arquivo .png, .jpg, .gif ou .webp.',
          },
        ]);
        if (imageInputRef.current) imageInputRef.current.value = '';
        return;
      }
    }

    setIsProcessingImage(true);
    setChatHistory((prev) => [
      ...prev,
      {role: 'model', text: 'Analisando a imagem...'},
    ]);

    try {
      const base64Image = await fileToBase64(file);
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            {inlineData: {data: base64Image, mimeType: mimeType}},
            {
              text: 'Analyze this image. Identify key concepts, ideas, or keywords. Return a JSON object with a single key "keywords" which is an array of strings.',
            },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              keywords: {type: Type.ARRAY, items: {type: Type.STRING}},
            },
          },
        },
      });

      const parsed = JSON.parse(response.text);
      const extractedKeywords: string[] = parsed.keywords || [];

      if (extractedKeywords.length > 0) {
        updateActivePage({
          keywords: [...activePage.keywords, ...extractedKeywords],
        });
        const confirmationMessage: ChatMessage = {
          role: 'model',
          text: `Analisei a imagem e adicionei as seguintes palavras-chave a esta página: **${extractedKeywords.join(
            ', ',
          )}**.`,
        };
        setChatHistory((prev) => [...prev, confirmationMessage]);
      } else {
        setChatHistory((prev) => [
          ...prev,
          {
            role: 'model',
            text: 'Não consegui extrair palavras-chave claras da imagem.',
          },
        ]);
      }
    } catch (error) {
      console.error('Image analysis error:', error);
      setChatHistory((prev) => [
        ...prev,
        {
          role: 'model',
          text: 'Desculpe, ocorreu um erro ao analisar a imagem.',
        },
      ]);
    } finally {
      setIsProcessingImage(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleDeleteKeyword = (indexToDelete: number) => {
    updateActivePage({
      keywords: activePage.keywords.filter((_, index) => index !== indexToDelete),
    });
  };

  const handleDeleteInstruction = (indexToDelete: number) => {
    updateActivePage({
      instructions: activePage.instructions.filter(
        (_, index) => index !== indexToDelete,
      ),
    });
  };

  const handleToggleFocus = (
    type: 'keyword' | 'instruction',
    index: number,
  ) => {
    setFocusedItems((prev) => {
      const key = type === 'keyword' ? 'keywords' : 'instructions';
      const currentItems = prev[key];
      const newItems = currentItems.includes(index)
        ? currentItems.filter((i) => i !== index)
        : [...currentItems, index];
      return {...prev, [key]: newItems};
    });
  };

  const handleAddNewPage = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newPageName.trim();
    if (!name) return;
    const newPage = createNewPage(`page-${Date.now()}`, name);
    setPages([...pages, newPage]);
    setActivePageIndex(pages.length);
    setNewPageName('');
    setIsPageModalOpen(false);
  };

  const handleDeletePage = (indexToDelete: number) => {
    if (
      indexToDelete === 0 ||
      !window.confirm(
        `Tem certeza que deseja excluir a página "${pages[indexToDelete].name}"? Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }

    setPages((prevPages) => {
      const newPages = prevPages.filter((_, i) => i !== indexToDelete);
      let newActiveIndex = activePageIndex;

      if (indexToDelete === activePageIndex) {
        newActiveIndex = Math.max(0, indexToDelete - 1);
      } else if (indexToDelete < activePageIndex) {
        newActiveIndex = activePageIndex - 1;
      }
      setActivePageIndex(newActiveIndex);
      return newPages;
    });
  };

  const handleSaveVersion = () => {
    if (!activePage || !activePage.generatedImage) return;
    if (activePage.versions.includes(activePage.generatedImage)) {
      return;
    }
    const newVersions = [...activePage.versions, activePage.generatedImage];
    updateActivePage({versions: newVersions});
  };

  const handleDeleteVersion = (indexToDelete: number) => {
    const newVersions = activePage.versions.filter(
      (_, i) => i !== indexToDelete,
    );
    updateActivePage({versions: newVersions});
  };

  const handleRestoreVersion = (versionIndex: number) => {
    if (!activePage || !activePage.versions[versionIndex]) return;
    const versionToRestore = activePage.versions[versionIndex];
    updateActivePage({generatedImage: versionToRestore});
  };

  const handleAddContext = (pageId: string) => {
    if (!pageId || activePage.contextPageIds.includes(pageId)) return;
    const newContextIds = [...activePage.contextPageIds, pageId];
    updateActivePage({contextPageIds: newContextIds});
  };

  const handleRemoveContext = (pageId: string) => {
    const newContextIds = activePage.contextPageIds.filter(
      (id) => id !== pageId,
    );
    updateActivePage({contextPageIds: newContextIds});
  };

  const otherPages = pages.filter((p) => p.id !== 'master');

  return (
    <>
      <div className="min-h-screen notebook-paper-bg text-gray-900 flex flex-col justify-start items-center">
        <main className="container mx-auto px-3 sm:px-6 py-5 sm:py-10 pb-32 max-w-full w-full">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
            {/* Keywords & Instructions Panel */}
            <aside className="xl:col-span-2 bg-white/80 p-4 border-2 border-gray-300 shadow-sm h-fit">
              <h2 className="text-xl font-bold mb-4 font-mega text-gray-700">
                Palavras-chave
              </h2>
              {activePage?.id === 'master' ? (
                // Master Page Keyword View
                otherPages.length > 0 ? (
                  <div className="space-y-4">
                    {otherPages.map((page) => (
                      <div key={page.id}>
                        <h3 className="font-bold text-gray-600 text-sm mb-1">
                          {page.name}
                        </h3>
                        {page.keywords.length > 0 ? (
                          <ul className="space-y-1">
                            {page.keywords.map((keyword, index) => (
                              <li
                                key={index}
                                className="text-gray-800 font-mono text-xs p-1 bg-yellow-100/50 border-l-2 border-yellow-400">
                                {keyword}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-gray-400 italic">
                            Nenhuma
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">
                    Crie novas páginas para ver o resumo das palavras-chave aqui.
                  </p>
                )
              ) : // Regular Page Keyword View
              activePage?.keywords.length === 0 ? (
                <p className="text-gray-500 text-sm">
                  Suas ideias para "{activePage.name}" aparecerão aqui...
                </p>
              ) : (
                <ul className="space-y-2">
                  {activePage.keywords.map((keyword, index) => (
                    <li
                      key={index}
                      onClick={() => handleToggleFocus('keyword', index)}
                      className={`flex justify-between items-center text-gray-800 font-mono text-sm p-2 border-l-4 group cursor-pointer transition-all ${
                        focusedItems.keywords.includes(index)
                          ? 'bg-yellow-200 border-yellow-500 ring-2 ring-yellow-400'
                          : 'bg-yellow-100/50 border-yellow-400 hover:bg-yellow-100'
                      }`}>
                      <span className="break-words pr-2">{keyword}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteKeyword(index);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                        aria-label={`Remover palavra-chave ${keyword}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <h2 className="text-xl font-bold mt-6 mb-4 font-mega text-gray-700">
                Instruções
              </h2>
              {activePage?.id === 'master' ? (
                // Master Page Instruction View
                otherPages.length > 0 ? (
                  <div className="space-y-4">
                    {otherPages.map((page) => (
                      <div key={page.id}>
                        <h3 className="font-bold text-gray-600 text-sm mb-1">
                          {page.name}
                        </h3>
                        {page.instructions.length > 0 ? (
                          <ul className="space-y-1">
                            {page.instructions.map((instruction, index) => (
                              <li
                                key={index}
                                className="text-gray-800 font-mono text-xs p-1 bg-blue-100/50 border-l-2 border-blue-400">
                                {instruction}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-gray-400 italic">
                            Nenhuma
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">
                    As instruções de outras páginas serão resumidas aqui.
                  </p>
                )
              ) : // Regular Page Instruction View
              activePage?.instructions.length === 0 ? (
                <p className="text-gray-500 text-sm">
                  Suas instruções para a IA...
                </p>
              ) : (
                <ul className="space-y-2">
                  {activePage.instructions.map((instruction, index) => (
                    <li
                      key={index}
                      onClick={() => handleToggleFocus('instruction', index)}
                      className={`flex justify-between items-center text-gray-800 font-mono text-sm p-2 border-l-4 group cursor-pointer transition-all ${
                        focusedItems.instructions.includes(index)
                          ? 'bg-blue-200 border-blue-500 ring-2 ring-blue-400'
                          : 'bg-blue-100/50 border-blue-400 hover:bg-blue-100'
                      }`}>
                      <span className="break-words pr-2">{instruction}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteInstruction(index);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                        aria-label={`Remover instrução ${instruction}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Context Section */}
              <h2 className="text-xl font-bold mt-6 mb-4 font-mega text-gray-700">
                Contexto
              </h2>
              {activePage?.id !== 'master' ? (
                <div className="space-y-2">
                  {activePage.contextPageIds.map((pageId) => {
                    const contextPage = pages.find((p) => p.id === pageId);
                    if (!contextPage) return null;
                    return (
                      <div
                        key={pageId}
                        className="flex justify-between items-center text-gray-800 font-mono text-xs p-2 bg-green-100/50 border-l-4 border-green-400">
                        <span className="break-words pr-2">
                          {contextPage.name}
                        </span>
                        <button
                          onClick={() => handleRemoveContext(pageId)}
                          className="text-gray-500 hover:text-red-600"
                          aria-label={`Remover contexto ${contextPage.name}`}>
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                  <div className="relative">
                    <select
                      onChange={(e) => {
                        handleAddContext(e.target.value);
                        e.target.value = '';
                      }}
                      value=""
                      className="w-full text-sm p-2 border border-gray-300 rounded bg-white"
                      aria-label="Adicionar contexto de outra página">
                      <option value="" disabled>
                        + Adicionar Contexto...
                      </option>
                      {pages
                        .filter(
                          (p) =>
                            p.id !== activePage.id &&
                            p.id !== 'master' &&
                            !activePage.contextPageIds.includes(p.id),
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 text-sm">
                  O contexto é gerado automaticamente para a página Master.
                </p>
              )}
            </aside>

            {/* Main Content */}
            <div className="xl:col-span-7">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-2 sm:mb-6 gap-2">
                <h1 className="text-2xl sm:text-3xl font-bold mb-0 leading-tight font-mega">
                  Gemini Mind Map
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
                    onClick={handleExportJson}
                    className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm transition-all hover:bg-gray-50 hover:scale-110 mr-2">
                    <FileJson
                      className="w-5 h-5 text-gray-700"
                      aria-label="Exportar para JSON"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadProject}
                    className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm transition-all hover:bg-gray-50 hover:scale-110 mr-2">
                    <Download
                      className="w-5 h-5 text-gray-700"
                      aria-label="Fazer download do Projeto (ZIP)"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={clearProject}
                    className="w-10 h-10 rounded-full flex items-center justify-center bg-white shadow-sm transition-all hover:bg-gray-50 hover:scale-110">
                    <Trash2
                      className="w-5 h-5 text-gray-700"
                      aria-label="Clear Project"
                    />
                  </button>
                </menu>
              </div>

              {/* Pages Tabs */}
              <div className="flex items-center border-b-2 border-black mb-1">
                {pages.map((page, index) => (
                  <div
                    key={page.id}
                    className={`flex items-center border-t-2 border-l-2 border-r-2 -mb-0.5 ${
                      index === activePageIndex
                        ? 'bg-white border-black'
                        : 'bg-gray-200 border-gray-400'
                    }`}>
                    <button
                      onClick={() => setActivePageIndex(index)}
                      className={`px-3 py-2 text-sm font-medium ${
                        index === activePageIndex
                          ? 'text-black'
                          : 'text-gray-600 hover:bg-gray-300'
                      }`}>
                      {page.name}
                    </button>
                    {index === activePageIndex && index !== 0 && (
                      <button
                        onClick={() => handleDeletePage(index)}
                        className="pr-2 text-gray-400 hover:text-red-500"
                        aria-label={`Excluir página ${page.name}`}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setIsPageModalOpen(true)}
                  className="px-3 py-2 text-gray-600 hover:bg-gray-300">
                  <Plus className="w-5 h-5" />
                </button>
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
                      A IA está desenhando...
                    </p>
                  </div>
                )}
              </div>

              {/* Versions Gallery */}
              {activePage && activePage.versions.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-lg font-bold font-mega text-gray-700 mb-2">
                    Versões Salvas
                  </h3>
                  <div className="flex gap-3 overflow-x-auto p-2 bg-gray-200/50 rounded-md border border-gray-300">
                    {activePage.versions.map((version, index) => (
                      <div
                        key={index}
                        className="flex-shrink-0 group relative">
                        <img
                          src={version}
                          onClick={() => handleRestoreVersion(index)}
                          className="w-32 h-auto aspect-video border-2 border-gray-400 rounded-sm cursor-pointer hover:border-blue-500 hover:ring-2 hover:ring-blue-400 transition-all"
                          alt={`Versão ${index + 1}`}
                        />
                        <button
                          onClick={() => handleDeleteVersion(index)}
                          className="absolute top-1 right-1 p-1 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-opacity"
                          aria-label={`Excluir versão ${index + 1}`}>
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <form onSubmit={handlePromptSubmit} className="w-full">
                <div className="relative">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={
                      activePage?.id === 'master'
                        ? 'Adicione ideias em outras páginas para vê-las aqui'
                        : "Palavras-chave (use ';') ou instruções (use 'i:')"
                    }
                    className="w-full p-3 sm:p-4 pr-12 sm:pr-14 text-sm sm:text-base border-2 border-black bg-white text-gray-800 shadow-sm focus:ring-2 focus:ring-gray-200 focus:outline-none transition-all font-mono"
                    required
                    disabled={activePage?.id === 'master'}
                  />
                  <button
                    type="submit"
                    disabled={activePage?.id === 'master'}
                    className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 p-1.5 sm:p-2 rounded-none bg-black text-white hover:cursor-pointer hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors">
                    <SendHorizontal className="w-5 sm:w-6 h-5 sm:h-6" />
                  </button>
                </div>
              </form>
            </div>

            {/* Chat Panel */}
            <aside className="xl:col-span-3 bg-white/80 p-4 border-2 border-gray-300 shadow-sm flex flex-col max-h-[85vh]">
              <h2 className="text-xl font-bold mb-4 font-mega text-gray-700 flex-shrink-0">
                Chat com IA
              </h2>
              <div className="flex-grow overflow-y-auto mb-4 pr-2 space-y-4">
                {chatHistory.map((msg, index) => (
                  <div
                    key={index}
                    className={`flex items-start gap-2.5 ${
                      msg.role === 'user' ? 'justify-end' : ''
                    }`}>
                    {msg.role === 'model' && (
                      <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
                        <BotMessageSquare className="w-5 h-5 text-white" />
                      </div>
                    )}
                    <div
                      className={`prose prose-sm max-w-none p-3 rounded-lg md:max-w-sm ${
                        msg.role === 'user'
                          ? 'bg-yellow-200 text-gray-800 rounded-br-none'
                          : 'bg-gray-100 text-gray-700 rounded-bl-none'
                      }`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
                      <BotMessageSquare className="w-5 h-5 text-white" />
                    </div>
                    <div className="p-3 rounded-lg bg-gray-100">
                      <LoaderCircle className="w-5 h-5 text-gray-500 animate-spin" />
                    </div>
                  </div>
                )}
                <div ref={chatMessagesEndRef} />
              </div>

              <div className="flex-shrink-0 mt-auto">
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <button
                    onClick={handleSaveVersion}
                    disabled={
                      isLoading || isProcessingImage || !activePage.generatedImage
                    }
                    className="w-full flex items-center justify-center gap-2 p-3 text-sm font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-500 disabled:bg-gray-400 transition-colors">
                    <Save className="w-5 h-5" />
                    Salvar
                  </button>
                  <button
                    onClick={() => generateMindMap('rethink')}
                    disabled={isLoading || isProcessingImage}
                    className="w-full flex items-center justify-center gap-2 p-3 text-sm font-semibold bg-gray-600 text-white rounded-md hover:bg-gray-500 disabled:bg-gray-400 transition-colors">
                    <RefreshCw className="w-5 h-5" />
                    Repensar
                  </button>
                  <button
                    onClick={() => generateMindMap('evolve')}
                    disabled={isLoading || isProcessingImage}
                    className="w-full flex items-center justify-center gap-2 p-3 text-sm font-semibold bg-gray-800 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-400 transition-colors">
                    <Sparkles className="w-5 h-5" />
                    Atualizar
                  </button>
                </div>

                <form onSubmit={handleSendChatMessage} className="w-full">
                  <div className="relative">
                    <input
                      type="file"
                      ref={imageInputRef}
                      onChange={handleImageInputChange}
                      className="hidden"
                      accept="image/png, image/jpeg, image/webp, image/gif"
                    />
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Converse ou envie uma imagem..."
                      className="w-full p-3 pr-20 text-sm border-2 border-gray-400 bg-white text-gray-800 rounded-md focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all font-mono"
                      disabled={isChatLoading || isProcessingImage}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={
                          isChatLoading ||
                          isProcessingImage ||
                          activePage?.id === 'master'
                        }
                        className="p-1.5 text-gray-500 hover:text-gray-800 disabled:text-gray-300 transition-colors">
                        <Paperclip className="w-5 h-5" />
                      </button>
                      <button
                        type="submit"
                        disabled={isChatLoading || isProcessingImage}
                        className="p-1.5 text-gray-500 hover:text-gray-800 disabled:text-gray-300 transition-colors">
                        <SendHorizontal className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </aside>
          </div>
        </main>

        {/* New Page Modal */}
        {isPageModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
              <h3 className="text-xl font-bold text-gray-700 mb-4">
                Criar Nova Página
              </h3>
              <form onSubmit={handleAddNewPage}>
                <input
                  type="text"
                  value={newPageName}
                  onChange={(e) => setNewPageName(e.target.value)}
                  placeholder="Nome da página..."
                  className="w-full p-3 text-base border-2 border-gray-300 bg-white text-gray-800 rounded-md shadow-sm focus:ring-2 focus:ring-gray-400 focus:outline-none transition-all"
                  required
                  autoFocus
                />
                <div className="flex justify-end gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setIsPageModalOpen(false)}
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

        {/* Error Modal */}
        {showErrorModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-bold text-gray-700">
                  Ocorreu um erro
                </h3>
                <button
                  onClick={() => setShowErrorModal(false)}
                  className="text-gray-400 hover:text-gray-500">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="font-medium text-gray-600">
                {parseError(errorMessage)}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}