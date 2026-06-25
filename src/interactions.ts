/**
 * interactions.ts — Boss interaction definitions for clickable furniture
 *
 * Each interaction defines what happens when the boss clicks a furniture item:
 * - walkTo: position to walk to (near the item)
 * - effect: sprite to show above boss on arrival
 * - duration: how long the effect lasts (ms)
 * - chatMessage: what to post in office chat
 * - furnitureState: optional state change for the furniture item
 * - cooldown: minimum ms between interactions with this item
 */

export interface Interaction {
  walkTo: { x: number; y: number }
  effect: string
  duration: number
  chatMessage: string | string[]
  furnitureState?: { id: string; state: string; revertAfter?: number }
  cooldown: number
  sound?: string
}

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function getInteraction(furnitureId: string): Interaction | null {
  switch (furnitureId) {
    // Plants — water them
    case 'plant-1':
      return { walkTo: { x: 90, y: 65 }, effect: '/sprites/effects/watering-can.png', duration: 3000, chatMessage: ['watering the monstera', 'plant care time', 'stay green little guy'], cooldown: 30000 }
    case 'plant-2':
      return { walkTo: { x: 41, y: 40 }, effect: '/sprites/effects/watering-can.png', duration: 3000, chatMessage: ['watering the snake plant', 'hydration station', 'these leaves are looking good'], cooldown: 30000 }
    case 'plant-3':
      return { walkTo: { x: 30, y: 72 }, effect: '/sprites/effects/watering-can.png', duration: 3000, chatMessage: ['watering the money tree', 'grow baby grow', 'office jungle maintenance'], cooldown: 30000 }
    case 'plant-4':
      return { walkTo: { x: 87, y: 66 }, effect: '/sprites/effects/watering-can.png', duration: 3000, chatMessage: ['watering the plants', 'keeping the office green'], cooldown: 30000 }
    case 'plant-5':
      return { walkTo: { x: 58, y: 81 }, effect: '/sprites/effects/watering-can.png', duration: 3000, chatMessage: ['watering the monstera', 'this one is thriving'], cooldown: 30000 }

    // Coffee machine
    case 'coffee':
      return {
        walkTo: { x: 76, y: 56 },
        effect: '/sprites/effects/need-coffee.png',
        duration: 4000,
        chatMessage: ['brewing a fresh pot', 'coffee time!', 'fueling up', 'who else needs coffee?'],
        furnitureState: { id: 'coffee', state: 'on', revertAfter: 10000 },
        cooldown: 15000,
        sound: 'coffee',
      }

    // Filing cabinet
    case 'filing-1':
      return {
        walkTo: { x: 47, y: 58 },
        effect: '/sprites/effects/post-it.png',
        duration: 3000,
        chatMessage: ['checking the files', 'where did I put that doc...', 'filing cabinet raid', 'looking for the Q4 report'],
        furnitureState: { id: 'filing-1', state: 'open', revertAfter: 8000 },
        cooldown: 10000,
      }

    // Printer
    case 'printer-1':
      return {
        walkTo: { x: 83, y: 63 },
        effect: '/sprites/effects/post-it.png',
        duration: 3000,
        chatMessage: ['printing something', 'please dont jam...', 'old faithful', 'who even prints anymore'],
        cooldown: 15000,
      }

    // Whiteboard / kanban board — use the board area
    case 'whiteboard':
      return {
        walkTo: { x: 88, y: 56 },
        effect: '/sprites/effects/post-it.png',
        duration: 4000,
        chatMessage: ['updating the board', 'moving tickets to done', 'adding a post-it', 'sprint planning time'],
        cooldown: 20000,
      }

    // Background hotspots
    case 'fire-extinguisher':
      return { walkTo: { x: 16, y: 66 }, effect: '/sprites/effects/fire.png', duration: 3000, chatMessage: ['checking the fire extinguisher', 'safety first', 'still in date, nice', 'hope we never need this'], cooldown: 30000 }

    case 'water-cooler':
      return { walkTo: { x: 53, y: 47 }, effect: '/sprites/effects/glass-water.png', duration: 3000, chatMessage: ['filling up the bottle', 'hydration check', 'water break', 'staying hydrated'], cooldown: 10000 }

    case 'bell':
      return { walkTo: { x: 63, y: 46 }, effect: '/sprites/effects/star.png', duration: 2000, chatMessage: ['ding ding! standup time', 'ringing the bell', 'attention everyone!', 'all hands!'], cooldown: 20000, sound: 'bell' }

    case 'kanban-board':
      return { walkTo: { x: 78, y: 48 }, effect: '/sprites/effects/post-it.png', duration: 4000, chatMessage: ['updating the board', 'moving tickets to done', 'sprint looks good', 'who left this ticket in review?'], cooldown: 15000 }

    case 'ship-it-poster':
      return { walkTo: { x: 16, y: 55 }, effect: '/sprites/effects/rocket.png', duration: 3000, chatMessage: ['ship it!', 'feeling motivated', 'that poster never gets old', 'lets gooo'], cooldown: 30000 }

    case 'tv-monitor':
      return { walkTo: { x: 85, y: 50 }, effect: '/sprites/effects/typing.png', duration: 3000, chatMessage: ['checking the dashboard', 'all systems green', 'monitoring the metrics', 'uptime looking solid'], cooldown: 15000 }

    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// AISole (Thai) flavor — used instead of the English Office lines when the app
// runs in AISole mode, so no foreign names (Kevin, etc.) leak into the chat.
// ---------------------------------------------------------------------------

const TH_INTERACTION: Record<string, string[]> = {
  plant: ['รดน้ำต้นไม้หน่อย', 'ดูแลต้นไม้ในออฟฟิศนิดนึง', 'ใบเขียวสดดีนะต้นนี้', 'เดี๋ยวรดน้ำให้นะ'],
  coffee: ['ชงกาแฟสดสักแก้ว', 'ได้เวลากาแฟแล้ว!', 'เติมพลังก่อน', 'ใครอยากได้กาแฟบ้าง'],
  filing: ['ขอเปิดดูแฟ้มเอกสารหน่อย', 'เอกสารอยู่ไหนนะ...', 'ค้นแฟ้มหารายงานแป๊บ', 'หาเอกสารสักครู่'],
  printer: ['ขอปริ้นงานหน่อย', 'อย่าเพิ่งกระดาษติดนะ...', 'เครื่องปริ้นคู่ใจ', 'ปริ้นเอกสารแป๊บนึง'],
  board: ['อัปเดตบอร์ดงานหน่อย', 'ย้ายงานไปช่องเสร็จแล้ว', 'แปะโน้ตเพิ่มนิดนึง', 'มาวางแผนงานกัน'],
  fire: ['เช็คถังดับเพลิงหน่อย', 'ความปลอดภัยต้องมาก่อน', 'ยังไม่หมดอายุ ดีเลย', 'หวังว่าจะไม่ได้ใช้นะ'],
  water: ['เติมน้ำใส่ขวดหน่อย', 'เช็คน้ำดื่มแป๊บ', 'พักดื่มน้ำสักหน่อย', 'เติมความชุ่มชื้นให้ร่างกาย'],
  bell: ['ตี๊งๆ ได้เวลาประชุมยืน!', 'สั่นกระดิ่งเรียกทุกคน', 'ทุกคนมารวมตัวหน่อย!', 'ขอความสนใจหน่อยครับ'],
  ship: ['ปล่อยของเลย!', 'ฮึดขึ้นมาเลย', 'โปสเตอร์นี้ปลุกใจทุกที', 'ลุยกันเลย'],
  tv: ['เช็คแดชบอร์ดหน่อย', 'ระบบเขียวหมด เรียบร้อย', 'ดูตัวเลขสถานะแป๊บ', 'อัปไทม์ดูนิ่งดี'],
}

function categoryFor(itemId: string): keyof typeof TH_INTERACTION {
  if (itemId.startsWith('plant')) return 'plant'
  if (itemId === 'coffee') return 'coffee'
  if (itemId.startsWith('filing')) return 'filing'
  if (itemId.startsWith('printer')) return 'printer'
  if (itemId === 'whiteboard' || itemId === 'kanban-board') return 'board'
  if (itemId === 'fire-extinguisher') return 'fire'
  if (itemId === 'water-cooler') return 'water'
  if (itemId === 'bell') return 'bell'
  if (itemId === 'ship-it-poster') return 'ship'
  if (itemId === 'tv-monitor') return 'tv'
  return 'board'
}

/** Thai chat line for a furniture interaction (AISole mode). */
export function thaiInteractionMessage(itemId: string): string {
  return pick(TH_INTERACTION[categoryFor(itemId)])
}

const TH_COFFEE_BREAK = ['ขอพักจิบกาแฟแป๊บ', 'เบรกกาแฟก่อน เดี๋ยวมาต่อ', 'ใครเอากาแฟไหม เดี๋ยวชงให้', 'พักสมองนิดนึง ไปหากาแฟก่อน']
const TH_WATER_BREAK = ['ขอเติมน้ำหน่อย คอแห้ง', 'ไปกดน้ำดื่มแป๊บ', 'พักดื่มน้ำสักหน่อย', 'เติมน้ำให้ร่างกายหน่อย']

/** Thai break line (AISole mode). */
export function thaiBreakMessage(kind: 'coffee' | 'water'): string {
  return pick(kind === 'water' ? TH_WATER_BREAK : TH_COFFEE_BREAK)
}
