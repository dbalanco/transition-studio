import React, { useState, useRef } from 'react';
import { 
  Upload, 
  Film, 
  Play, 
  X, 
  Clock, 
  ArrowRight, 
  Download, 
  Layers,
  ChevronLeft,
  ChevronRight,
  RotateCcw
} from 'lucide-react';

interface MediaState {
  url: string;
  data: string;
  mimeType: string;
  size?: number;
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REF_VIDEO_BYTES = 30 * 1024 * 1024;
const MAX_COMBINED_MEDIA_BYTES = 35 * 1024 * 1024;

function getRawMediaBytes(m?: { data: string; size?: number } | null): number {
  if (!m) return 0;
  if (typeof m.size === 'number' && m.size > 0) return m.size;
  return Math.floor(((m.data || '').length * 3) / 4);
}

let fallbackClientId = '';
function getClientId(): string {
  const key = 'aistudio_client_id';
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing && /^[a-zA-Z0-9._-]{8,128}$/.test(existing)) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    window.sessionStorage.setItem(key, generated);
    return generated;
  } catch {
    if (!fallbackClientId) {
      fallbackClientId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    }
    return fallbackClientId;
  }
}

interface Segment {
  url: string;
  data: string;
  mimeType: string;
  kind: 'transition' | 'extension';
  duration?: number;
  isRerendered?: boolean;
}

interface HistoryItem {
  id: string;
  segments: Segment[];
  prompt: string;
  timestamp: Date;
}

const TRANSITIONS = [
  {
    id: 'object-portal',
    name: 'Object Portal',
    hint: 'Enter a real opening in scene one and emerge naturally into scene two',
    block: `TECHNIQUE — OBJECT PORTAL:
Use a visible object or opening in the FIRST scene as a physical gateway into the LAST scene: door, window, mirror, tunnel, circular opening, or similar form.

START: Move the camera continuously toward the chosen opening until its interior dominates the frame.
BRIDGE: Pass physically THROUGH the opening. At the midpoint, the opening or its dark/interior surface must fill 100% of the frame, completely hiding the surrounding scene.
TRANSITION: While the frame is fully occupied by the portal interior, transform that interior space into the corresponding entry point of the LAST scene. NO VFX / Motion Graphics for the transition.
END: Continue the same camera movement out of the portal into the LAST scene and settle naturally into the target composition.

Maintain one uninterrupted camera move. No visible cut, dissolve, teleport, or abrupt perspective change. Make sure the scenes are matched and transition seamlessly. The portal itself must motivate and conceal the scene change.`
  },

  {
    id: 'whip-pan',
    name: 'Whip Pan',
    hint: 'A rapid pan creates full-frame motion blur that hides the scene change',
    block: `TECHNIQUE — WHIP PAN:
Transition between scenes using one continuous, high-speed horizontal camera pan.

START: Begin in the FIRST scene, then rapidly accelerate the camera left or right.
BRIDGE: The pan becomes fast enough to create strong directional motion blur across the ENTIRE frame. No recognizable environment should remain visible at peak speed.
TRANSITION: Change from the FIRST environment to the LAST environment only while the image is completely obscured by motion blur.
END: Continue the pan in the SAME direction and with consistent momentum, then smoothly decelerate until the camera lands precisely on the LAST frame's composition.

The transition must feel like one physical camera movement. Match pan direction, camera height, lens perspective, and apparent velocity across the hidden midpoint. No flash, dissolve, jump cut, or reversal of direction.`
  },

  {
    id: 'match-cut-morph',
    name: 'Match Morph',
    hint: 'A shared shape stays aligned while its material and world transform around it',
    block: `TECHNIQUE — MATCH MORPH:
Find the strongest visual geometry shared by the FIRST and LAST frames: a circle, face, silhouette, doorway, horizon, vehicle, building edge, centered object, or other matching form.

START: Reframe or move the camera so the shared shape in the FIRST scene aligns with the position, scale, angle, and silhouette of its counterpart in the LAST scene.
BRIDGE: Lock that geometry in place as the visual anchor. Its outer contour should remain stable while its texture, material, lighting, and identity gradually transform.
TRANSITION: Morph the surrounding environment at the same time, radiating naturally outward from the matched shape until the FIRST scene has fully become the LAST scene.
END: Finish with the matching geometry now belonging entirely to the LAST scene, aligned exactly with the target frame.

Prioritize silhouette continuity and spatial alignment. Avoid melting, random deformation, double exposure, or independent object movement that breaks the matched geometry. The transformation should read as one object/world evolving into another, not a crossfade.`
  },

  {
    id: 'sky-drop',
    name: 'Sky Drop',
    hint: 'Leave one world through an overhead surface and descend from it into the next',
    block: `TECHNIQUE — SKY DROP:
Use an overhead visual field as the seamless bridge between the FIRST and LAST scenes: open sky, clouds, ceiling, canopy, lights, fog, tree cover, water surface, or similar texture.

START: From the FIRST scene, tilt, crane, rise, or fly the camera upward until the overhead surface completely fills the frame and the original ground environment disappears.
BRIDGE: Continue moving through the full-frame sky/ceiling texture. During this visually ambiguous overhead moment, gradually transform its color, lighting, weather, structure, or texture into the overhead environment of the LAST scene.
TRANSITION: Preserve camera momentum and orientation while the overhead field becomes unmistakably part of the new world.
END: Reverse the framing movement by tilting or descending out of the new overhead surface, revealing the LAST scene below and settling into its target composition.

The overhead texture must fully conceal the environment change. No hard cut or arbitrary dissolve. The motion should feel like the camera traveled continuously through one vertical passage between worlds.`
  },

  {
    id: 'through-the-crowd',
    name: 'Foreground Wipe',
    hint: 'A close foreground object fully covers the lens and reveals the next scene behind it',
    block: `TECHNIQUE — FOREGROUND WIPE:
Use a believable foreground subject to physically wipe across the camera and hide the transition: person, coat, vehicle, wall, pillar, door, tree trunk, sign, fabric, or another large object passing very close to the lens.

START: Begin in the FIRST scene while the wiping element approaches or crosses the camera's view.
BRIDGE: The foreground element passes so close to the lens that it covers 100% of the frame for a brief moment.
TRANSITION: Change the environment only while the lens is completely occluded.
END: As the SAME or visually compatible foreground element clears the lens, reveal the LAST scene behind it and continue the existing camera or subject motion naturally.

Match the wipe's direction, speed, scale, color, and depth on both sides of the transition. The foreground object should plausibly exist in both scenes. Do not reveal the new environment until the frame has been fully covered. No dissolve or visible cut.`
  },

  {
    id: 'time-machine',
    name: 'Time Machine',
    hint: 'The viewpoint stays fixed while the same location transforms through time',
    block: `TECHNIQUE — TIME MACHINE:
Interpret the FIRST and LAST frames as the SAME physical location viewed at different moments, seasons, years, or historical eras.

START: Establish the FIRST scene and lock the camera to a stable viewpoint. A very slow push-in is acceptable, but the spatial perspective must remain consistent.
BRIDGE: Accelerate the passage of time around the camera. Show continuous temporal change through moving sunlight and shadows, weather, seasons, construction, decay, vegetation growth, traffic, crowds, aging materials, changing signage, or evolving architecture.
TRANSITION: Preserve permanent landmarks, major geometry, horizon position, and spatial layout so the viewer always understands this is the same place changing through time.
END: Gradually slow the temporal motion until the world settles completely into the LAST frame's era, lighting, environment, and exact composition.

The CAMERA does not travel through space; TIME travels around the camera. Avoid teleporting objects, unrelated morphing, or changing the location's fundamental geometry unless the change is motivated by visible construction, destruction, growth, or decay.`
  }
] as const;


export default function App() {
  const [prompt, setPrompt] = useState("");
  const [technique, setTechnique] = useState<string | null>(null);
  const [extendPrompt, setExtendPrompt] = useState("");
  const [image1, setImage1] = useState<MediaState | null>(null);
  const [image2, setImage2] = useState<MediaState | null>(null);
  const [references, setReferences] = useState<MediaState[]>([]);
  const [isGenerating, setGenerating] = useState(false);
  const [generatingLabel, setGeneratingLabel] = useState("Rendering...");
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number>(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  
  const fileInput1Ref = useRef<HTMLInputElement>(null);
  const fileInput2Ref = useRef<HTMLInputElement>(null);
  const fileInputRefRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setMedia: React.Dispatch<React.SetStateAction<MediaState | null>>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        setError("Please select an image file (PNG, JPG, WEBP).");
        e.target.value = '';
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError("Image exceeds the 20MB per-image limit. Please select an image under 20MB.");
        e.target.value = '';
        return;
      }
      const otherImage = setMedia === setImage1 ? image2 : image1;
      const refsBytes = references.reduce((sum, r) => sum + getRawMediaBytes(r), 0);
      if (file.size + getRawMediaBytes(otherImage) + refsBytes > MAX_COMBINED_MEDIA_BYTES) {
        setError("Combined media exceeds the 35MB limit per generation. Please use smaller files.");
        e.target.value = '';
        return;
      }
      setError(null);
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        const base64Data = result.split(',')[1];
        setMedia({ url: result, data: base64Data, mimeType: file.type, size: file.size });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRefFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && references.length < 3) {
      if (file.size > MAX_REF_VIDEO_BYTES) {
        setError("Reference video exceeds the 30MB per-video limit. Please select a video under 30MB.");
        e.target.value = '';
        return;
      }
      const existingBytes =
        getRawMediaBytes(image1) +
        getRawMediaBytes(image2) +
        references.reduce((sum, r) => sum + getRawMediaBytes(r), 0);
      if (existingBytes + file.size > MAX_COMBINED_MEDIA_BYTES) {
        setError("Combined media exceeds the 35MB limit per generation. Please use smaller files.");
        e.target.value = '';
        return;
      }
      setError(null);
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        const base64Data = result.split(',')[1];
        setReferences(prev => [...prev, { url: result, data: base64Data, mimeType: file.type, size: file.size }]);
      };
      reader.readAsDataURL(file);
    }
  };

  const pollJob = async (jobId: string): Promise<{url: string, data: string, mimeType: string}> => {
    const started = Date.now();
    while (true) {
      await new Promise(r => setTimeout(r, 4000));
      const elapsed = Math.round((Date.now() - started) / 1000);
      setGeneratingLabel(prev => prev.replace(/( \· \d+s)?$/, ` · ${elapsed}s`));
      const statusRes = await fetch(`/api/job/${jobId}`, {
        headers: { 'x-client-id': getClientId() },
      });
      if (!statusRes.ok) throw new Error('Lost connection to the render job.');
      const status = await statusRes.json();
      if (status.status === 'error') throw new Error(status.error || 'Render processing failed.');
      if (status.status === 'done') {
        const resultRes = await fetch(`/api/job/${jobId}/result`, {
          headers: { 'x-client-id': getClientId() },
        });
        if (!resultRes.ok) throw new Error('Failed to retrieve finished render.');
        const blob = await resultRes.blob();
        const safeMime = /^video\/(mp4|webm)$/i.test(blob.type) ? blob.type : 'video/mp4';
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ url: URL.createObjectURL(blob), data: (reader.result as string).split(',')[1], mimeType: safeMime });
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
    }
  };

  const handleGenerate = async () => {
    if ((!prompt.trim() && !technique) || !image1 || !image2) {
      setError("Please select a transition technique or provide scene direction, and supply both keyframe images.");
      return;
    }
    const totalMediaBytes =
      getRawMediaBytes(image1) +
      getRawMediaBytes(image2) +
      references.reduce((sum, r) => sum + getRawMediaBytes(r), 0);
    if (totalMediaBytes > MAX_COMBINED_MEDIA_BYTES) {
      setError("Combined media exceeds the 35MB total limit per generation. Please upload smaller images or reference videos.");
      return;
    }
    
    setError(null);
    setGenerating(true);
    setGeneratingLabel("Rendering Transition...");
    
    try {
      const mediaParts = [
        { data: image1.data, mimeType: image1.mimeType },
        { data: image2.data, mimeType: image2.mimeType }
      ];
      const selected = TRANSITIONS.find(t => t.id === technique);
      const fullPrompt = `Task: Create one continuous, uncut cinematic transition from the First frame to the Last frame.
${selected ? selected.block : 'TECHNIQUE — DIRECTOR\'S CHOICE: Choose the single most visually striking transition technique that suits these two frames (object portal, whip pan, match morph, sky drop, foreground wipe, or time-lapse transformation). Commit to it fully.'}
Additional user instructions: ${prompt || 'None.'}
CRITICAL RULES:
1. Single continuous camera move; begin exactly on the First frame and end exactly on the Last frame.
2. Execute the named technique boldly — this is a showcase transition, not a subtle dissolve.
3. No hard cuts, no crossfades, no new characters.`;

      const res = await fetch('/api/omni', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-id': getClientId() },
        body: JSON.stringify({ 
          prompt: fullPrompt, 
          format: 'video', 
          media: mediaParts,
          references: references.map(r => ({ data: r.data, mimeType: r.mimeType }))
        })
      });
      
      const { jobId, error: jobError } = await res.json();
      if (jobError || !jobId) throw new Error(jobError || 'Failed to initiate render queue.');
      const data = await pollJob(jobId);
      
      const newSeg: Segment = { url: data.url, data: data.data, mimeType: data.mimeType, kind: 'transition' };
      setSegments([newSeg]);
      setSelectedSegmentIndex(0);
      
      const newId = Date.now().toString();
      setActiveHistoryId(newId);
      setHistory(prev => {
        const newHistory = [{
          id: newId,
          segments: [newSeg],
          prompt: `${selected ? selected.name + ': ' : ''}${prompt || 'Direction applied'}`,
          timestamp: new Date()
        }, ...prev];
        const kept = newHistory.slice(0, 10);
        const dropped = newHistory.slice(10);
        dropped.forEach(item => {
          item.segments.forEach(seg => {
            if (seg.url && seg.url.startsWith('blob:')) {
              URL.revokeObjectURL(seg.url);
            }
          });
        });
        return kept;
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred during rendering.");
    } finally {
      setGenerating(false);
    }
  };

  const handleExtend = async () => {
    const lastSegment = segments[segments.length - 1];
    if (!lastSegment) return;

    const totalExtendBytes =
      getRawMediaBytes(lastSegment) +
      getRawMediaBytes(image1) +
      getRawMediaBytes(image2);
    if (totalExtendBytes > MAX_COMBINED_MEDIA_BYTES) {
      setError("Combined media for scene extension exceeds the 35MB total limit. Please use smaller keyframe images.");
      return;
    }
    
    setError(null);
    setGenerating(true);
    setGeneratingLabel("Extending Scene...");
    
    try {
      const res = await fetch('/api/omni', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-client-id': getClientId() },
        body: JSON.stringify({ 
          mode: 'extend',
          video: lastSegment.data,
          mimeType: lastSegment.mimeType,
          sourceMedia: [image1, image2].filter(Boolean).map(m => ({ data: m!.data, mimeType: m!.mimeType })),
          prompt: extendPrompt
        })
      });

      const { jobId, error: jobError } = await res.json();
      if (jobError || !jobId) throw new Error(jobError || 'Failed to initiate extension queue.');
      const data = await pollJob(jobId);
      
      const newSeg: Segment = { url: data.url, data: data.data, mimeType: data.mimeType, kind: 'extension' };
      const newSegments = [...segments, newSeg];
      setSegments(newSegments);
      setSelectedSegmentIndex(newSegments.length - 1);
      setHistory(hist => hist.map(h => h.id === activeHistoryId ? { ...h, segments: newSegments } : h));
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred during extension.");
    } finally {
      setGenerating(false);
    }
  };

  const handleStartOver = () => {
    if (isGenerating) return;
    setImage1(null);
    setImage2(null);
    setReferences([]);
    setPrompt("");
    setTechnique(null);
    setExtendPrompt("");
    setSegments([]);
    setSelectedSegmentIndex(0);
    setActiveHistoryId(null);
    setError(null);
    if (fileInput1Ref.current) fileInput1Ref.current.value = '';
    if (fileInput2Ref.current) fileInput2Ref.current.value = '';
    if (fileInputRefRef.current) fileInputRefRef.current.value = '';
  };

  const handleExport = () => {
    if (segments.length === 0) return;
    segments.forEach((seg, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = seg.url;
        let ext = 'mp4';
        const mimeMatch = seg.mimeType.match(/video\/(.+)/);
        if (mimeMatch && mimeMatch[1]) {
          ext = mimeMatch[1];
        }
        a.download = segments.length > 1 ? `transition-studio-take-${i + 1}.${ext}` : `transition-studio-take.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, i * 400);
    });
  };

  return (
    <div className="flex h-screen w-full bg-black text-white overflow-hidden select-none font-normal">
      
      {/* Reel Archive Panel (Left-aligned, collapsible) */}
      <aside 
        className={`bg-black border-r border-[#1a1a1a] flex flex-col z-20 transition-all duration-300 ease-in-out shrink-0 ${
          isArchiveOpen ? 'w-72 xl:w-80' : 'w-12'
        }`}
      >
        {/* Reel Archive Header / Toggle */}
        <div className="h-14 border-b border-[#1a1a1a] flex items-center justify-between px-3 bg-black shrink-0">
          {isArchiveOpen ? (
            <>
              <div className="flex items-center space-x-2.5 pl-2 overflow-hidden">
                <Clock size={16} strokeWidth={2} className="text-white shrink-0" />
                <h2 className="text-xs uppercase tracking-widest text-white font-bold truncate">
                  Reel Archive
                </h2>
                <span className="text-[10px] text-neutral-400 font-mono font-medium px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 shrink-0">
                  {history.length}
                </span>
              </div>
              <button
                onClick={() => setIsArchiveOpen(false)}
                className="w-7 h-7 rounded flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-900 transition-colors"
                title="Collapse Reel Archive"
                aria-label="Collapse Reel Archive"
              >
                <ChevronLeft size={16} strokeWidth={2} />
              </button>
            </>
          ) : (
            <div className="w-full flex flex-col items-center justify-center py-2">
              <button
                onClick={() => setIsArchiveOpen(true)}
                className="w-7 h-7 rounded flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-900 transition-colors"
                title="Expand Reel Archive"
                aria-label="Expand Reel Archive"
              >
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>

        {/* Collapsed view indicator icon button */}
        {!isArchiveOpen ? (
          <div className="flex-1 flex flex-col items-center py-6 space-y-6">
            <button
              onClick={() => setIsArchiveOpen(true)}
              className="flex flex-col items-center group text-neutral-400 hover:text-white"
              title={`Expand Reel Archive (${history.length} ${history.length === 1 ? 'take' : 'takes'})`}
            >
              <div className="w-8 h-8 rounded bg-[#111111] border border-neutral-800 flex items-center justify-center group-hover:border-neutral-600 transition-colors">
                <Clock size={14} strokeWidth={2} className="text-neutral-300 group-hover:text-white" />
              </div>
              {history.length > 0 && (
                <span className="mt-2 text-[10px] font-mono text-neutral-400 font-bold bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-800">
                  {history.length}
                </span>
              )}
            </button>
            <div 
              onClick={() => setIsArchiveOpen(true)}
              className="[writing-mode:vertical-rl] text-[10px] uppercase tracking-widest text-neutral-500 font-bold cursor-pointer hover:text-neutral-300 transition-colors pt-2 select-none"
            >
              Reel Archive
            </div>
          </div>
        ) : (
          /* Expanded list of takes */
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {history.length === 0 ? (
              <div className="text-center text-neutral-500 text-xs mt-16 px-4 leading-relaxed">
                Rendered takes will be preserved here in the session archive.
              </div>
            ) : (
              history.map(item => {
                const isSelected = activeHistoryId === item.id;
                return (
                  <div 
                    key={item.id} 
                    onClick={() => {
                      setSegments(item.segments);
                      setPrompt(item.prompt);
                      setActiveHistoryId(item.id);
                      setSelectedSegmentIndex(0);
                    }}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all duration-150 ${
                      isSelected 
                        ? 'border-white bg-[#141414]' 
                        : 'border-[#222222] bg-[#0a0a0a] hover:border-neutral-600 hover:bg-[#111111]'
                    }`}
                  >
                    <div className="aspect-video bg-black rounded-lg overflow-hidden mb-2 relative group">
                      <video 
                        src={item.segments[0].url} 
                        className="w-full h-full object-cover" 
                        muted 
                        loop 
                        onMouseEnter={(e) => e.currentTarget.play()} 
                        onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} 
                      />
                      {item.segments.length > 1 && (
                        <div className="absolute bottom-1.5 right-1.5 bg-black/90 border border-neutral-700 px-1.5 py-0.5 rounded text-[9px] text-white font-bold">
                          {item.segments.length} seg
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Play size={16} className="text-white fill-white" />
                      </div>
                    </div>
                    <p className="text-xs text-neutral-200 line-clamp-2 leading-relaxed font-medium">
                      {item.prompt}
                    </p>
                    <div className="text-[10px] text-neutral-400 mt-1.5 flex items-center justify-between font-mono">
                      <span>{item.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      <span className="text-white font-bold tracking-wider uppercase text-[9px]">Recall Take</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </aside>

      {/* Left Sidebar - Keyframes & Reference Materials */}
      <aside className="w-72 xl:w-80 bg-black border-r border-[#1a1a1a] flex flex-col z-10 shrink-0 h-full">
        
        {/* Studio Branding Header */}
        <div className="p-4 lg:p-5 border-b border-[#1a1a1a] shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-7 h-7 rounded-md bg-white text-black flex items-center justify-center font-bold">
                <Film size={15} strokeWidth={2} />
              </div>
              <div>
                <h1 className="text-xs font-bold tracking-wider text-white uppercase">
                  Transition Studio
                </h1>
                <p className="text-[10px] text-neutral-400 font-normal tracking-wide">
                  Dual-Frame Sequence Atelier
                </p>
              </div>
            </div>
            <span className="text-[9px] tracking-widest uppercase border border-neutral-700 bg-neutral-900 px-2 py-0.5 rounded text-white font-semibold">
              Omni 1.1
            </span>
          </div>
        </div>
        
        {/* Source Media Ingestion */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-5 space-y-5">
          
          {/* First Keyframe */}
          <div className="space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="text-xs uppercase tracking-widest text-neutral-300 font-semibold">
                Head Frame (In)
              </span>
              <span className="text-[10px] text-neutral-500 font-medium">Departure</span>
            </div>
            <div 
              onClick={() => !isGenerating && fileInput1Ref.current?.click()}
              className={`relative aspect-video rounded-xl border border-[#222222] bg-[#080808] overflow-hidden cursor-pointer transition-all duration-200 group ${
                isGenerating ? 'opacity-30 pointer-events-none' : 'hover:border-white/40 hover:bg-[#111111]'
              }`}
            >
              {image1 ? (
                <>
                  <img src={image1.url} className="w-full h-full object-cover" alt="Head frame" />
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setImage1(null);
                      if (fileInput1Ref.current) fileInput1Ref.current.value = '';
                    }}
                    className="absolute top-2 right-2 bg-black/80 hover:bg-white hover:text-black text-white p-1 rounded-md transition-all opacity-0 group-hover:opacity-100 shadow-md"
                    title="Remove image"
                  >
                    <X size={12} />
                  </button>
                  <div className="absolute bottom-2 right-2 bg-white text-black px-2 py-0.5 rounded text-[9px] tracking-wider uppercase font-bold">
                    Initial Point
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-400 space-y-1.5 p-3">
                  <div className="w-8 h-8 rounded-full bg-[#141414] border border-[#262626] flex items-center justify-center text-white">
                    <Upload size={14} strokeWidth={1.75} />
                  </div>
                  <span className="text-xs font-medium text-neutral-200">Select image</span>
                  <span className="text-[9px] text-neutral-500 uppercase tracking-wider">Image Frame</span>
                </div>
              )}
              <input 
                type="file" 
                ref={fileInput1Ref} 
                onChange={(e) => handleFileChange(e, setImage1)} 
                accept="image/*" 
                className="hidden" 
              />
            </div>
          </div>
          
          {/* Second Keyframe */}
          <div className="space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="text-xs uppercase tracking-widest text-neutral-300 font-semibold">
                Tail Frame (Out)
              </span>
              <span className="text-[10px] text-neutral-500 font-medium">Arrival</span>
            </div>
            <div 
              onClick={() => !isGenerating && fileInput2Ref.current?.click()}
              className={`relative aspect-video rounded-xl border border-[#222222] bg-[#080808] overflow-hidden cursor-pointer transition-all duration-200 group ${
                isGenerating ? 'opacity-30 pointer-events-none' : 'hover:border-white/40 hover:bg-[#111111]'
              }`}
            >
              {image2 ? (
                <>
                  <img src={image2.url} className="w-full h-full object-cover" alt="Tail frame" />
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setImage2(null);
                      if (fileInput2Ref.current) fileInput2Ref.current.value = '';
                    }}
                    className="absolute top-2 right-2 bg-black/80 hover:bg-white hover:text-black text-white p-1 rounded-md transition-all opacity-0 group-hover:opacity-100 shadow-md"
                    title="Remove image"
                  >
                    <X size={12} />
                  </button>
                  <div className="absolute bottom-2 right-2 bg-white text-black px-2 py-0.5 rounded text-[9px] tracking-wider uppercase font-bold">
                    Landing Point
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-400 space-y-1.5 p-3">
                  <div className="w-8 h-8 rounded-full bg-[#141414] border border-[#262626] flex items-center justify-center text-white">
                    <Upload size={14} strokeWidth={1.75} />
                  </div>
                  <span className="text-xs font-medium text-neutral-200">Select image</span>
                  <span className="text-[9px] text-neutral-500 uppercase tracking-wider">Image Frame</span>
                </div>
              )}
              <input 
                type="file" 
                ref={fileInput2Ref} 
                onChange={(e) => handleFileChange(e, setImage2)} 
                accept="image/*" 
                className="hidden" 
              />
            </div>
          </div>

        </div>
      </aside>

      {/* Main Workspace Stage */}
      <main className="flex-1 flex flex-col bg-black relative min-w-0 h-full overflow-hidden">
        
        {/* Editorial Top Bar */}
        <header className="h-14 border-b border-[#1a1a1a] flex items-center justify-end px-6 bg-black shrink-0">
          <div className="flex items-center space-x-2.5">
            <button 
              onClick={handleStartOver}
              disabled={isGenerating || (!image1 && !image2 && references.length === 0 && segments.length === 0 && !prompt && !technique)}
              className="border border-[#262626] bg-[#0c0c0c] text-neutral-300 hover:text-white hover:bg-[#161616] hover:border-neutral-600 disabled:opacity-30 disabled:hover:bg-[#0c0c0c] disabled:hover:text-neutral-300 disabled:cursor-not-allowed text-xs px-3 py-1.5 rounded-md transition-colors flex items-center space-x-1.5 font-medium uppercase tracking-wider"
              title="Reset frames, prompts, and active sequence"
            >
              <RotateCcw size={12} strokeWidth={2} />
              <span>Start Over</span>
            </button>
            <button 
              onClick={handleExport}
              disabled={segments.length === 0 || isGenerating}
              className="border border-neutral-700 bg-white text-black hover:bg-neutral-200 disabled:opacity-20 disabled:hover:bg-white disabled:cursor-not-allowed text-xs px-3.5 py-1.5 rounded-md transition-colors flex items-center space-x-1.5 font-bold uppercase tracking-wider"
            >
              <Download size={13} strokeWidth={2} />
              <span>{segments.length > 1 ? 'Export Takes' : 'Export Sequence'}</span>
            </button>
          </div>
        </header>

        {/* Video Canvas Stage with responsive height & width bounding */}
        <div className="flex-1 min-h-0 p-4 lg:p-6 flex flex-col items-center justify-center relative overflow-hidden bg-black">
          
          <div className="w-full h-full max-w-5xl flex flex-col items-center justify-center min-h-0 gap-3">
            <div className="relative flex-1 min-h-0 w-full flex items-center justify-center">
              <div className="h-full aspect-video max-w-full max-h-full bg-black rounded-xl overflow-hidden shadow-2xl relative border border-[#222222] ring-1 ring-white/10 flex items-center justify-center group">
                
                {segments.length > 0 && segments[selectedSegmentIndex] ? (
                  <video 
                    src={segments[selectedSegmentIndex].url} 
                    className="w-full h-full object-cover" 
                    autoPlay 
                    loop 
                    controls
                  />
                ) : (
                  <div className="text-center p-8 flex flex-col items-center justify-center text-neutral-400 space-y-3">
                    <div className="w-14 h-14 rounded-full bg-[#111111] border border-neutral-800 flex items-center justify-center text-white shadow-inner">
                      <Film size={22} strokeWidth={1.5} />
                    </div>
                    <div className="text-sm font-semibold text-white tracking-wide">
                      Load Departure and Arrival Frames
                    </div>
                    <p className="text-xs text-neutral-400 max-w-md leading-relaxed">
                      Omni 1.1 bridges both frames into a single, uncut cinematic trajectory.
                    </p>
                  </div>
                )}
                
                {/* Cinematic Rendering Overlay */}
                {isGenerating && (
                  <div className="absolute inset-0 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center z-20">
                    <div className="flex flex-col items-center space-y-4">
                      <div className="w-10 h-10 border-2 border-neutral-800 border-t-white rounded-full animate-spin"></div>
                      <div className="text-center space-y-1">
                        <span className="text-xs font-bold tracking-wider text-white block uppercase">
                          {generatingLabel}
                        </span>
                        <span className="text-[10px] text-neutral-400">
                          Synthesizing motion trajectory and optical physics
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Extension Controls below Video */}
            {!isGenerating && segments.length > 0 && selectedSegmentIndex === segments.length - 1 && (
              <div className="flex items-center space-x-2.5 w-full max-w-3xl shrink-0">
                <input 
                  type="text" 
                  value={extendPrompt} 
                  onChange={e => setExtendPrompt(e.target.value)} 
                  placeholder="Extension notes (lighting, velocity, continuation)..." 
                  className="flex-1 bg-[#0c0c0c] border border-[#262626] focus:border-white outline-none rounded-lg text-xs text-white placeholder-neutral-500 px-3.5 py-2 font-normal transition-colors" 
                />
                <button 
                  onClick={handleExtend} 
                  className="bg-white hover:bg-neutral-200 text-black font-bold text-xs px-4 py-2 rounded-lg flex items-center space-x-1.5 transition-all shrink-0 uppercase tracking-wider"
                >
                  <span>Extend +10s</span>
                  <ArrowRight size={12} strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-red-950/90 border border-red-800 text-red-200 px-5 py-2.5 rounded-lg text-xs max-w-lg text-center backdrop-blur-md shadow-2xl z-50 flex items-center space-x-3">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-200 hover:text-white">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Editorial Control Console */}
        <div className="p-4 lg:px-6 lg:py-4 border-t border-[#1a1a1a] bg-black shrink-0">
          
          {/* Technique Selector */}
          <div className="max-w-5xl mx-auto mb-3">
            <div className="mb-2">
              <span className="text-[10px] uppercase tracking-widest text-neutral-400 font-bold">
                Transition Technique
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {TRANSITIONS.map(t => {
                const isActive = technique === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTechnique(isActive ? null : t.id)}
                    disabled={isGenerating}
                    title={t.hint}
                    className={`px-3 py-1.5 rounded-md text-xs transition-all duration-150 border disabled:opacity-30 font-medium tracking-wide ${
                      isActive 
                        ? 'bg-white border-white text-black shadow-md' 
                        : 'border-[#262626] bg-[#0c0c0c] text-neutral-300 hover:border-neutral-500 hover:text-white hover:bg-[#141414]'
                    }`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Direction Note and Render Action */}
          <div className="max-w-5xl mx-auto flex items-center space-x-3">
            
            {/* Direction Note Input */}
            <div className="flex-1 bg-[#0c0c0c] border border-[#262626] rounded-lg flex items-center px-4 py-2.5 focus-within:border-white transition-colors">
              <span className="text-[10px] tracking-widest uppercase text-neutral-400 font-mono border-r border-[#262626] pr-3 mr-3 shrink-0 font-bold">
                Direction Note
              </span>
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isGenerating}
                className="flex-1 bg-transparent border-none outline-none text-xs text-white placeholder-neutral-500 disabled:opacity-30 font-normal"
                placeholder="Specify camera pace, velocity, atmospheric lighting, or optical focus..."
              />
            </div>

            {/* Primary Action Button */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || (!prompt.trim() && !technique) || !image1 || !image2}
              className="bg-white hover:bg-neutral-200 text-black font-bold text-xs px-5 py-2.5 rounded-lg flex items-center space-x-2 transition-all disabled:opacity-20 disabled:hover:bg-white disabled:cursor-not-allowed shrink-0 uppercase tracking-wider"
            >
              <span>Render Transition</span>
              <ArrowRight size={13} strokeWidth={2.5} />
            </button>
          </div>

          {/* Sequence Timeline Strip */}
          {segments.length > 0 && (
            <div className="max-w-5xl mx-auto mt-3 pt-3 border-t border-[#1a1a1a] flex items-center text-[11px] text-neutral-400 space-x-4">
              <span className="font-mono text-neutral-300 font-bold">00:00</span>
              <div className="flex-1 flex h-6 bg-[#0c0c0c] border border-[#262626] rounded-md overflow-hidden p-0.5 space-x-1">
                {segments.map((seg, idx) => (
                  <button 
                    key={idx}
                    onClick={() => !isGenerating && setSelectedSegmentIndex(idx)}
                    className={`flex-1 h-full rounded cursor-pointer transition-all flex items-center justify-center text-[9px] tracking-wider uppercase font-bold ${
                      selectedSegmentIndex === idx 
                        ? 'bg-white text-black' 
                        : 'bg-[#181818] text-neutral-300 hover:bg-[#222222]'
                    }`}
                  >
                    {seg.kind === 'transition' ? `Take 01 (Transition)` : `Extension 0${idx}`}
                  </button>
                ))}
              </div>
              <span className="font-mono text-neutral-300 font-bold">
                {`00:${(segments.length * 10).toString().padStart(2, '0')}`}
              </span>
              <span className="text-[9px] uppercase tracking-widest text-neutral-500 font-bold">Duration</span>
            </div>
          )}

          {/* Legal / Policy Disclaimer */}
          <div className="max-w-5xl mx-auto mt-3 pt-2.5 border-t border-[#161616] text-[10px] text-neutral-400 leading-relaxed space-y-0.5">
            <p>
              By using this feature, you confirm that you have the necessary rights to any content that you upload. Do not generate content that infringes on others’ intellectual property or privacy rights. Your use of this generative AI service is subject to our{' '}
              <a 
                href="https://policies.google.com/terms/generative-ai/use-policy" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-neutral-200 underline underline-offset-2 hover:text-white transition-colors"
              >
                Prohibited Use Policy
              </a>.
            </p>
            <p>
              Please note that uploads, including those from Google Workspace, may be used to develop and improve Google products and services in accordance with our{' '}
              <a 
                href="https://ai.google.dev/gemini-api/terms" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-neutral-200 underline underline-offset-2 hover:text-white transition-colors"
              >
                terms
              </a>.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
