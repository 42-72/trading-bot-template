import { useStore } from '@/hooks/useStore';

/** The scanner's store inside the scanner's own components. */
export const useAiScanner = () => useStore().ai_scanner;
