"use client";
import { useEffect, useRef, useState, useContext } from "react";
import CodePreview from "./components/CodePreview";
import Preview from "./components/Preview";
import { CodeGenerationParams, generateCode } from "./generateCode";
import Spinner from "./components/Spinner";
import classNames from "classnames";
import {
  FaCode,
  FaDesktop,
  FaDownload,
  FaMobile,
  FaUndo,
} from "react-icons/fa";

import { Switch } from "./components/ui/switch";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Settings, EditorTheme, AppState, GeneratedCodeConfig } from "./types";
import { IS_RUNNING_ON_CLOUD } from "./config";
import OnboardingNote from "./components/OnboardingNote";
// import { UrlInputSection } from "./components/UrlInputSection";
import html2canvas from "html2canvas";
import { History } from "./components/history/history_types";
import HistoryDisplay from "./components/history/HistoryDisplay";
import { extractHistoryTree } from "./components/history/utils";
import toast from "react-hot-toast";
import {UploadFileContext} from './contexts/UploadFileContext';
import {SettingContext} from './contexts/SettingContext';
import {HistoryContext} from './contexts/HistoryContext';
import NativePreview from './components/NativeMobile';
import UpdateChatInput from './components/chatInput/Update';
import dynamic from "next/dynamic";
import {getPartCodeUid} from './compiler';
// import CodeTab from "./components/CodeTab";
const CodeTab = dynamic(
  async () => (await import("./components/CodeTab")),
  {
    ssr: false,
  },
)

// const Whiteboard = dynamic(
//   async () => (await import("./components/Whiteboard")),
//   {
//     ssr: false,
//   },
// )

const PreviewBox = dynamic(
  async () => (await import("../engine")),
  {
    ssr: false,
  },
)

const IS_OPENAI_DOWN = false;
let firstRun = true;

function App() {
  const [appState, setAppState] = useState<AppState>(AppState.INITIAL);
  const [generatedCode, setGeneratedCode] = useState<string>('');

  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [executionConsole, setExecutionConsole] = useState<string[]>([]);
  const [updateInstruction, setUpdateInstruction] = useState("");
  const {
    dataUrls
  } = useContext(UploadFileContext)
  
  // Settings
  const {settings, setSettings} = useContext(SettingContext);

  const {history, addHistory,  currentVersion, setCurrentVersion,} = useContext(HistoryContext);


  // App history
  const [appHistory, setAppHistory] = useState<History>([]);
  // Tracks the currently shown version from app history

  const [shouldIncludeResultImage, setShouldIncludeResultImage] =
    useState<boolean>(false);

  const wsRef = useRef<AbortController>(null);

  // When the user already has the settings in local storage, newly added keys
  // do not get added to the settings so if it's falsy, we populate it with the default
  // value
  useEffect(() => {
    if (!settings.generatedCodeConfig) {
      setSettings({
        ...settings,
        generatedCodeConfig: GeneratedCodeConfig.HTML_TAILWIND,
      });
    }
    
  }, [settings.generatedCodeConfig, setSettings]);

  useEffect(() => {
    if (dataUrls.length && firstRun) {
      doCreate(dataUrls);
      firstRun = false;
    }
  }, []);

  const takeScreenshot = async (): Promise<string> => {
    const iframeElement = document.querySelector(
      "#preview-desktop"
    ) as HTMLIFrameElement;
    if (!iframeElement?.contentWindow?.document.body) {
      return "";
    }

    const canvas = await html2canvas(iframeElement.contentWindow.document.body);
    const png = canvas.toDataURL("image/png");
    return png;
  };

  const downloadCode = () => {
    // Create a blob from the generated code
    const blob = new Blob([generatedCode], { type: "text/html" });
    const url = URL.createObjectURL(blob);

    // Create an anchor element and set properties for download
    const a = document.createElement("a");
    a.href = url;
    a.download = "index.html"; // Set the file name for download
    document.body.appendChild(a); // Append to the document
    a.click(); // Programmatically click the anchor to trigger download

    // Clean up by removing the anchor and revoking the Blob URL
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setAppState(AppState.INITIAL);
    setGeneratedCode("");
    setReferenceImages([]);
    setExecutionConsole([]);
    setAppHistory([]);
  };

  const stop = () => {
    if (wsRef.current && !wsRef.current.signal.aborted) {
      wsRef.current.abort();
  }    // make sure stop can correct the state even if the websocket is already closed
    setAppState(AppState.CODE_READY);
  };

  function doGenerateCode(
    params: CodeGenerationParams,
    parentVersion: number | null
  ) {
    setExecutionConsole([]);
    setAppState(AppState.CODING);

    // Merge settings with params
    const updatedParams = { ...params, ...settings };

    generateCode(
      wsRef,
      updatedParams,
      (token) => setGeneratedCode((prev) => prev + token),
      (code) => {
        setGeneratedCode(code);
        addHistory(params.generationType, updateInstruction, referenceImages, code);
      },
      (line) => setExecutionConsole((prev) => [...prev, line]),
      () => {
        setAppState(AppState.CODE_READY);
      }
    );
  }

  // Initial version creation
  function doCreate(referenceImages: string[]) {
    // Reset any existing state
    reset();

    setReferenceImages(referenceImages);
    if (referenceImages.length > 0) {
      doGenerateCode(
        {
          generationType: "create",
          image: referenceImages[0],
        },
        currentVersion
      );
    }
  }

  // Subsequent updates
  async function doUpdate(partData?: any) {
    if (currentVersion === null) {
      toast.error(
        "No current version set. Contact support or open a Github issue."
      );
      return;
    }

    const updatedHistory = [
      ...extractHistoryTree(history, currentVersion),
      updateInstruction,
    ];

    if (shouldIncludeResultImage) {
      const resultImage = await takeScreenshot();
      doGenerateCode(
        {
          generationType: "update",
          image: referenceImages[0],
          resultImage: resultImage,
          history: updatedHistory,
        },
        currentVersion
      );
    } else {
      doGenerateCode(
        {
          generationType: "update",
          image: referenceImages[0],
          history: updatedHistory,
        },
        currentVersion
      );
    }

    setGeneratedCode("");
    setUpdateInstruction("");
  }

  async function doPartUpdate(partData?: any) {
    const {uid, message} = partData;
    const code = getPartCodeUid(uid);
    const updatePrompt = `
Change ${code} as follows:
${message}
Re-enter the code.
    `;
    setUpdateInstruction(updatePrompt);
  }

  
  useEffect(() => {
    const errorUpdate = updateInstruction.includes('Fix the code error and re-output the code');
    const partUpdate = updateInstruction.includes('Re-enter the code.');
    if (errorUpdate || partUpdate) {
      doUpdate();
    }
  }, [
    updateInstruction
  ])

  async function fixBug(error: {
    message: string;
    stack: string;
  }) {
    const errorPrompt = `
Fix the code error and re-output the code.
error message:
${error.message}
${error.stack}
    `;
    setUpdateInstruction(errorPrompt);
  }

  return (
    <div className="dark:bg-black dark:text-white h-full">
      <div className="lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-64 lg:flex-col">
        <div className="flex grow flex-col gap-y-2 overflow-y-auto border-r border-gray-200 bg-white px-6 dark:bg-zinc-950 dark:text-white">
          <div className="flex items-center justify-between mb-2 mt-2">
            <div className="flex">
            {appState === AppState.CODE_READY && (
              <>
                <span
                    onClick={reset}
                    className="hover:bg-slate-200 p-2 rounded-sm"                  >
                    <FaUndo />
                    {/* Reset */}
                </span>
                <span
                  onClick={downloadCode}
                  className="hover:bg-slate-200 p-2 rounded-sm"
                >
                  <FaDownload />
                </span>
              </>
            )}
            </div>
          </div>

          {IS_OPENAI_DOWN && (
            <div className="bg-black text-white dark:bg-white dark:text-black p-3 rounded">
              OpenAI API is currently down. Try back in 30 minutes or later. We
              apologize for the inconvenience.
            </div>
          )}

          {(appState === AppState.CODING ||
            appState === AppState.CODE_READY) && (
            <>
              {/* Show code preview only when coding */}
              {appState === AppState.CODING && (
                <div className="flex flex-col">
                  <div className="flex items-center gap-x-1">
                    <Spinner />
                    {executionConsole.slice(-1)[0]}
                  </div>
                  <div className="flex mt-4 w-full">
                    <Button
                      onClick={stop}
                      className="w-full dark:text-white dark:bg-gray-700"
                    >
                      Stop
                    </Button>
                  </div>
                </div>
              )}

              {appState === AppState.CODE_READY && (
                <div>
                  <div className="grid w-full gap-2">
                    <Textarea
                      placeholder="Tell the AI what to change..."
                      onChange={(e) => setUpdateInstruction(e.target.value)}
                      value={updateInstruction}
                    />
                    <div className="flex justify-between items-center gap-x-2">
                      <div className="font-500 text-xs text-slate-700 dark:text-white">
                        Include screenshot of current version?
                      </div>
                      <Switch
                        checked={shouldIncludeResultImage}
                        onCheckedChange={setShouldIncludeResultImage}
                        className="dark:bg-gray-700"
                      />
                    </div>
                    <Button
                      onClick={doUpdate}
                      className="dark:text-white dark:bg-gray-700"
                    >
                      Update
                    </Button>
                  </div>
                </div>
              )}

              {/* Reference image display */}
              <div className="flex gap-x-2 mt-2">
                <div className="flex flex-col">
                  <div
                    className={classNames({
                      "scanning relative": appState === AppState.CODING,
                    })}
                  >
                    <img
                      className="w-[340px] border border-gray-200 rounded-md"
                      src={referenceImages[0]}
                      alt="Reference"
                    />
                  </div>
                  <div className="text-gray-400 uppercase text-sm text-center mt-1">
                    Original Screenshot
                  </div>
                </div>
                <div className="bg-gray-400 px-4 py-2 rounded text-sm hidden">
                  <h2 className="text-lg mb-4 border-b border-gray-800">
                    Console
                  </h2>
                  {executionConsole.map((line, index) => (
                    <div
                      key={index}
                      className="border-b border-gray-400 mb-2 text-gray-600 font-mono"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {
            <HistoryDisplay
              history={appHistory}
              currentVersion={currentVersion}
              revertToVersion={(index) => {
                if (
                  index < 0 ||
                  index >= appHistory.length ||
                  !appHistory[index]
                )
                  return;
                setCurrentVersion(index);
                setGeneratedCode(appHistory[index].code);
              }}
              shouldDisableReverts={appState === AppState.CODING}
            />
          }
        </div>
      </div>
      <main className="pl-64 relative h-full flex flex-col pb-10">
          <div className="ml-4 w-[80%] ml-[10%] flex-1">
            <Tabs className="h-full flex flex-col" defaultValue={settings.generatedCodeConfig == GeneratedCodeConfig.REACT_NATIVE ? 'native' : 'desktop'}>
              <div className="flex justify-end mr-8 mb-4">
                <TabsList>
                  {
                    settings.generatedCodeConfig === GeneratedCodeConfig.REACT_NATIVE ? (
                      <TabsTrigger value="native" className="flex gap-x-2">
                      <FaDesktop /> native Mobile
                    </TabsTrigger>
                    ) : (
                      <>
                        <TabsTrigger value="desktop" className="flex gap-x-2">
                          <FaDesktop /> Desktop
                        </TabsTrigger>
                        <TabsTrigger value="mobile" className="flex gap-x-2">
                          <FaMobile /> Mobile
                        </TabsTrigger>
                      </>
                    )
                  }
                  <TabsTrigger value="code" className="flex gap-x-2">
                    <FaCode />
                    Code
                  </TabsTrigger>
                </TabsList>
              </div>
              {
                settings.generatedCodeConfig === GeneratedCodeConfig.REACT_NATIVE ? (
                  <TabsContent value="native">
                    <NativePreview code={generatedCode} appState={appState}/>
                  </TabsContent>
                ) : (
                  <>
                    <TabsContent value="desktop">
                      <PreviewBox  
                        code={generatedCode}
                        appState={appState}
                        sendMessageChange={(data) => {
                          doPartUpdate(data);
                        }}
                      />
                      {/* <Preview code={generatedCode} device="desktop" appState={appState} fixBug={fixBug}/> */}
                    </TabsContent>
                    <TabsContent value="mobile">
                      <Preview code={generatedCode} device="mobile" appState={appState} fixBug={fixBug}/>
                    </TabsContent>
                  </>
                )
              }
              <TabsContent value="code">
                <CodeTab
                  code={generatedCode}
                  setCode={setGeneratedCode}
                  settings={settings}
                />
              </TabsContent>
            </Tabs>
          </div>
          <div className="flex justify-center mt-10">
            <div className="w-[520px] rounded-md shadow-sm ">
              <UpdateChatInput />
            </div>
          </div>
      </main>
   
    </div>
  );
}

export default App;