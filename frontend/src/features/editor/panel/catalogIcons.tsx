import {
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Columns2,
  CreditCard,
  Download,
  Image as ImageIcon,
  Images,
  List,
  Megaphone,
  Minus,
  MousePointerClick,
  MoveVertical,
  Play,
  Share2,
  Square,
  Star,
  Table as TableIcon,
  Type,
  type LucideIcon,
} from "lucide-react";

/**
 * The catalog's own icons.
 *
 * Separate from the block's *content* icons: this is what a person looks for in a list, not
 * something a visitor ever sees. The registry names one per block as a string so the shared package
 * stays free of React, and this is where that name becomes a component.
 */
const ICONS: Record<string, LucideIcon> = {
  square: Square,
  minus: Minus,
  "move-vertical": MoveVertical,
  type: Type,
  star: Star,
  list: List,
  "mouse-pointer-click": MousePointerClick,
  table: TableIcon,
  image: ImageIcon,
  images: Images,
  play: Play,
  download: Download,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  columns: Columns2,
  megaphone: Megaphone,
  "credit-card": CreditCard,
  share: Share2,
  "clipboard-list": ClipboardList,
};

/** Falls back to a neutral square rather than rendering nothing, so a row keeps its shape. */
export function catalogIcon(name: string): LucideIcon {
  return ICONS[name] ?? Square;
}
