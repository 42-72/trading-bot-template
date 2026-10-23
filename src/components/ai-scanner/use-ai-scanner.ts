import { useStore } from '@/hooks/useStore';

/**
 * The scanner's store inside the scanner's own components. They only mount
 * when it exists (Layout renders <AiScanner /> only then - see
 * ai-scanner-switch.ts), so it is never null here.
 */
export const useAiScanner = () => {
    const { ai_scanner } = useStore();
    if (!ai_scanner) throw new Error('AI Scanner component rendered while the scanner is switched off');
    return ai_scanner;
};
