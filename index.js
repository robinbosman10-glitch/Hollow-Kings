import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import {
  gunzip as gunzipCallback,
  gzip as gzipCallback,
} from 'node:zlib';
import 'dotenv/config';
import {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder as DiscordEmbedBuilder,
  Events,
  FileUploadBuilder,
  GatewayIntentBits,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';

const HOLLOW_KINGS_LOGO_URL =
  process.env.HOLLOW_KINGS_LOGO_URL?.trim();

// Iedere embed krijgt bij het verzenden opnieuw het Hollow Kings-logo.
// Daardoor kunnen losse commandhandlers het centrale logo niet overschrijven.
class EmbedBuilder extends DiscordEmbedBuilder {
  static from(embed) {
    return new this(embed?.data ?? embed);
  }

  toJSON(validationOverride) {
    const logoUrl =
      HOLLOW_KINGS_LOGO_URL ||
      (typeof client !== 'undefined' && client.isReady()
        ? client.user.displayAvatarURL({ size: 256 })
        : null);

    if (logoUrl) {
      super.setThumbnail(logoUrl);
    }

    return super.toJSON(validationOverride);
  }
}

// Maak naast dit bestand een .env-bestand met:
// DISCORD_TOKEN=
// HOLLOW_KINGS_LOGO_URL= (publieke HTTPS-link naar Hollow.png)
// MESSAGE_LOG_CHANNEL_ID=
// MOD_LOG_CHANNEL_ID=
// MEMBER_LOG_CHANNEL_ID=
// ROLE_LOG_CHANNEL_ID=
// SERVER_LOG_CHANNEL_ID=
// VOICE_LOG_CHANNEL_ID=
// POINTS_SOURCE_CHANNEL_ID=
// POINTS_LOG_CHANNEL_ID=
// POINTS_ACTIVITY_LOG_CHANNEL_ID=
// POINTS_ACHIEVEMENT_CHANNEL_ID=
// POINTS_ACHIEVEMENT_ROLE_ID=
// PLUK_LOG_CHANNEL_ID=
// GIVEAWAY_LOG_CHANNEL_ID=
// EVENT_LOG_CHANNEL_ID= (optioneel; anders server-logkanaal)
// WARN_LOG_CHANNEL_ID= (optioneel; anders moderatie-/server-logkanaal)
// DISMISSAL_LOG_CHANNEL_ID= (optioneel; anders moderatie-/server-logkanaal)
// WARN_ROLE_IDS=warn_rol_id_1,warn_rol_id_2 (optioneel maar aanbevolen)
// COOLDOWN_CHANNEL_ID= (optioneel; anders het huidige kanaal)
// COOLDOWN_ROLE_ID=
// PROCESSING_REMINDER_CHANNEL_ID=
// PROCESSING_REMINDER_ROLE_ID=
// ABSENCE_LOG_CHANNEL_ID=
// ABSENCE_ROLE_ID=
// WEAPON_DEALER_ROLE_ID=
// ROBIN_BACKUP_ROLE_ID=
// GANG_MEMBER_LIMIT=50

const LOG_CHANNELS = {
  messages: process.env.MESSAGE_LOG_CHANNEL_ID,
  moderation: process.env.MOD_LOG_CHANNEL_ID,
  members: process.env.MEMBER_LOG_CHANNEL_ID,
  roles: process.env.ROLE_LOG_CHANNEL_ID,
  server: process.env.SERVER_LOG_CHANNEL_ID,
  voice: process.env.VOICE_LOG_CHANNEL_ID,
  points: process.env.POINTS_LOG_CHANNEL_ID,
  pointsActivity:
    process.env.POINTS_ACTIVITY_LOG_CHANNEL_ID?.trim() ||
    process.env.POINTS_LOG_CHANNEL_ID,
  giveaway:
    process.env.GIVEAWAY_LOG_CHANNEL_ID?.trim() ||
    process.env.SERVER_LOG_CHANNEL_ID,
  events:
    process.env.EVENT_LOG_CHANNEL_ID?.trim() ||
    process.env.SERVER_LOG_CHANNEL_ID,
  pluk:
    process.env.PLUK_LOG_CHANNEL_ID?.trim() ||
    process.env.SERVER_LOG_CHANNEL_ID,
  absence:
    process.env.ABSENCE_LOG_CHANNEL_ID?.trim() ||
    process.env.SERVER_LOG_CHANNEL_ID,
  warnings:
    process.env.WARN_LOG_CHANNEL_ID?.trim() ||
    process.env.MOD_LOG_CHANNEL_ID?.trim() ||
    process.env.SERVER_LOG_CHANNEL_ID,
  dismissals:
    process.env.DISMISSAL_LOG_CHANNEL_ID?.trim() ||
    process.env.MOD_LOG_CHANNEL_ID?.trim() ||
    process.env.SERVER_LOG_CHANNEL_ID,
};

const POINTS_SOURCE_CHANNEL_ID = process.env.POINTS_SOURCE_CHANNEL_ID;
const POINTS_ACHIEVEMENT_CHANNEL_ID =
  process.env.POINTS_ACHIEVEMENT_CHANNEL_ID?.trim();
const POINTS_ACHIEVEMENT_ROLE_ID =
  process.env.POINTS_ACHIEVEMENT_ROLE_ID?.trim();
const POINTS_DATA_VERSION = 6;
const POINTS_ACTIVITY_TYPES_VERSION = 2;
const POINTS_TIME_ZONE = 'Europe/Amsterdam';
const POINTS_DAILY_BACKFILL_PAGE_LIMIT = 100;
const POINTS_DAILY_ROLLOVER_BUFFER_MS = 250;
const POINTS_ACHIEVEMENT_MILESTONES = Object.freeze([
  Object.freeze({
    threshold: 50,
    name: 'Mijlpaal',
    color: 0x57F287,
    title: '🏆 50 PUNTEN • MIJLPAAL BEHAALD!',
    reactions: ['🏆'],
  }),
  Object.freeze({
    threshold: 100,
    name: 'Elite',
    color: 0x9B59B6,
    title: '💎 100 PUNTEN • ELITE STATUS!',
    reactions: ['💎', '🔥'],
  }),
  Object.freeze({
    threshold: 150,
    name: 'Hollow Kings Legend',
    color: 0xD4AF37,
    title: '👑🔥 150 PUNTEN • Hollow Kings LEGEND 🔥👑',
    reactions: ['👑', '🔥', '🏆'],
  }),
]);
const POINTS_FIRST_ACHIEVEMENT =
  POINTS_ACHIEVEMENT_MILESTONES[0].threshold;
const POINTS_HIGHEST_ACHIEVEMENT =
  POINTS_ACHIEVEMENT_MILESTONES.at(-1).threshold;
const POINTS_SUBMISSION_TYPES = Object.freeze({
  event: Object.freeze({
    label: 'Event',
    todayLabel: 'Events',
    emoji: '🎉',
    color: 0x9B59B6,
    matcher: /\bevent(?:s)?\b/i,
  }),
  winkel: Object.freeze({
    label: 'Winkel',
    todayLabel: 'Winkels',
    emoji: '🏪',
    color: 0x57F287,
    matcher: /\bwinkel(?:s)?\b/i,
  }),
  bank: Object.freeze({
    label: 'Bank',
    todayLabel: 'Banken',
    emoji: '🏦',
    color: 0x3498DB,
    matcher: /\bbank(?:en)?\b/i,
  }),
  juwelier: Object.freeze({
    label: 'Juwelier',
    todayLabel: 'Juweliers',
    emoji: '💎',
    color: 0x1ABC9C,
    matcher: /\bjuwelier(?:s)?\b/i,
  }),
  hitandrun: Object.freeze({
    label: 'Hit And Run',
    todayLabel: 'Hit And Run',
    emoji: '🚗',
    color: 0xE67E22,
    matcher: /\bhit\s*(?:and|&)\s*run\b/i,
  }),
  kippenfabriek: Object.freeze({
    label: 'Kippenfabriek',
    todayLabel: 'Kippenfabrieken',
    emoji: '🐔',
    color: 0xF1C40F,
    matcher: /\bkippenfabriek(?:en)?\b/i,
  }),
  humanelabs: Object.freeze({
    label: 'Humane Labs',
    todayLabel: 'Humane Labs',
    emoji: '🧪',
    color: 0x9B59B6,
    matcher: /\bhumane\s*labs?\b/i,
  }),
  fibbuilding: Object.freeze({
    label: 'FIB Building',
    todayLabel: 'FIB Building',
    emoji: '🏢',
    color: 0x5865F2,
    matcher: /\bfib\s*(?:building|gebouw)\b/i,
  }),
});
const POINTS_ACTIVITY_TYPE_KEYS = Object.freeze(
  Object.keys(POINTS_SUBMISSION_TYPES),
);
const POINTS_DATA_DIRECTORY =
  process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() ||
  process.env.POINTS_DATA_DIRECTORY?.trim() ||
  './data';
const POINTS_DATA_FILE = join(POINTS_DATA_DIRECTORY, 'points.json');
const ABSENCE_DATA_FILE = join(
  POINTS_DATA_DIRECTORY,
  'absences.json',
);
const PROCESSING_REMINDER_DATA_FILE = join(
  POINTS_DATA_DIRECTORY,
  'processing-reminders.json',
);
const GIVEAWAY_DATA_FILE = join(
  POINTS_DATA_DIRECTORY,
  'giveaways.json',
);
const COMMUNITY_DATA_FILE = join(
  POINTS_DATA_DIRECTORY,
  'community.json',
);
const SERVER_BACKUP_DIRECTORY = join(
  POINTS_DATA_DIRECTORY,
  'server-backups',
);
const SERVER_BACKUP_FORMAT = 'HOLLOW_KINGS_SERVER_BACKUP';
const SERVER_BACKUP_VERSION = 1;
const SERVER_BACKUP_MAX_INPUT_BYTES = 100 * 1024 * 1024;
const SERVER_BACKUP_MAX_OUTPUT_BYTES = 512 * 1024 * 1024;
const ROBIN_BACKUP_ROLE_ID =
  process.env.ROBIN_BACKUP_ROLE_ID?.trim();
const gzipAsync = promisify(gzipCallback);
const gunzipAsync = promisify(gunzipCallback);
const ABSENCE_ROLE_ID = process.env.ABSENCE_ROLE_ID?.trim();
const ABSENCE_EXPIRY_CHECK_INTERVAL_MS = 60 * 1000;
const PROCESSING_REMINDER_CHANNEL_ID =
  process.env.PROCESSING_REMINDER_CHANNEL_ID?.trim();
const PROCESSING_REMINDER_ROLE_ID =
  process.env.PROCESSING_REMINDER_ROLE_ID?.trim();
const PROCESSING_REMINDER_THRESHOLD = 1000;
const PROCESSING_REMINDER_DELAY_MS = 2 * 60 * 60 * 1000;
const PROCESSING_REMINDER_CHECK_INTERVAL_MS = 60 * 1000;
const GIVEAWAY_CHECK_INTERVAL_MS = 60 * 1000;
const GIVEAWAY_DRAFT_DURATION_MS = 30 * 60 * 1000;
const GIVEAWAY_TIME_ZONE = 'Europe/Amsterdam';
const GIVEAWAY_MAX_WINNERS = 20;
const COMMUNITY_CHECK_INTERVAL_MS = 60 * 1000;
const DASHBOARD_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const COOLDOWN_CHANNEL_ID =
  process.env.COOLDOWN_CHANNEL_ID?.trim();
const COOLDOWN_ROLE_ID =
  process.env.COOLDOWN_ROLE_ID?.trim();
const COOLDOWN_END_ROLE_ID = '1301202503496503376';
const COOLDOWN_DURATION_MS = 45 * 60 * 1000;
const EVENT_DRAFT_DURATION_MS = 15 * 60 * 1000;
const EVENT_MINIMUM_LEAD_MS = 5 * 60 * 1000;
const POINT_REACTION_EMOJIS = new Set(['🟢', '🔴']);
const APPLICATION_ROLE_ID = '1301218044986654760';
const STAFF_ACTION_ROLE_ID = '1317979247440035921';
const DISMISSAL_PRESERVED_ROLE_ID = '1301218044986654760';
const APPLICATION_BANNER_PATH = fileURLToPath(
  new URL('./Hollow-Kings-banner.png', import.meta.url),
);
const APPLICATION_BANNER_NAME = 'Hollow-Kings-banner.png';
const PLUK_ROLE_ID = '1518957917494186075';
const WARN_ROLE_IDS = new Set(
  (process.env.WARN_ROLE_IDS ?? '')
    .split(',')
    .map(roleId => roleId.trim())
    .filter(Boolean),
);
const WARN_ROLE_NAME_PATTERN = /warn|waarschuw/i;
const WARN_ROLE_FORBIDDEN_PERMISSIONS = Object.freeze([
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ViewAuditLog,
]);
const PLUK_BANNER_PATH = fileURLToPath(
  new URL('./Hollow-Kings-banner.png', import.meta.url),
);
const PLUK_BANNER_NAME = 'Hollow-Kings-banner.png';
const WEAPON_DEALER_ROLE_ID =
  process.env.WEAPON_DEALER_ROLE_ID?.trim();
const DEALER_SESSION_DURATION_MS = 30 * 60 * 1000;
const DEALER_MAX_CART_ITEMS = 25;
const DEALER_CATEGORY_MAXIMUMS = Object.freeze({
  1: 30_000,
  2: 200_000,
  3: 700_000,
  4: 1_000_000,
  5: 1_500_000,
  6: 1_600_000,
  7: 1_750_000,
  8: 2_000_000,
  9: 5_000_000,
  10: 20_000_000,
});

const APPLICATION_MESSAGES = {
  open: [
    '🎟️ **SOLLICITATIES GEOPEND – [Hollow Kings]** 🎟️',
    '',
    'Denk jij dat je hebt wat nodig is om deel uit te maken van ' +
      '**Hollow Kings**? Bewijs jezelf en dien een sollicitatie in.',
    '',
    '**Vereisten:**',
    '💎 Minimaal 16 jaar',
    '💎 Minimaal 5 dagen playtime',
    '💎 Actief, loyaal en betrouwbaar',
    '💎 Respect, discipline en teamwork zijn verplicht',
    '💎 APV/Serverregels volledig kennen',
    '💎 Ervaring binnen gangs is een pluspunt',
    '',
    '🏴 Bij **Hollow Kings** verdien je je plek. Loyaliteit wordt ' +
      'beloond, verraad wordt nooit vergeten.',
    '',
    '📩 Open een ticket en laat zien waarom jij thuishoort binnen de Familie.',
  ].join('\n'),
  closed: [
    '🚫 **SOLLICITATIES GESLOTEN – [Hollow Kings]** 🚫',
    '',
    'De sollicitaties voor **Hollow Kings** zijn momenteel **gesloten**.',
    '',
    '❌ Het is op dit moment **niet mogelijk** om een sollicitatie in te dienen.',
    '❌ Tickets met sollicitaties worden niet in behandeling genomen.',
    '',
    '🏴 Houd de aankondigingen goed in de gaten. Zodra de sollicitaties ' +
      'weer openen, wordt dit via een officiële melding bekendgemaakt.',
    '',
    '📢 Bedankt voor jullie interesse en begrip.',
  ].join('\n'),
};

const DEALER_CATALOG = [
  {
    id: '1',
    name: 'Categorie 1 - Attachments',
    items: [
      ['AK - Flashlight', 45_000],
      ['AK - Suppressor', 50_000],
      ['AK - Extended', 55_000],
      ['AK - Drum Mag', 60_000],
      ['AK - Grip', 60_000],
      ['AK - Scope Small', 65_000],
      ['AK - Scope Medium', 75_000],
      ['AK - Scope Holo', 80_000],
      ['Pistol - Flashlight', 35_000],
      ['Pistol - Suppressor', 40_000],
      ['Pistol - Compensator', 45_000],
      ['Pistol - Extended', 45_000],
      ['SMG - Flashlight', 40_000],
      ['SMG - Suppressor', 45_000],
      ['SMG - Extended', 50_000],
      ['SMG - Grip', 55_000],
      ['SMG - Scope Small', 60_000],
      ['SMG - Scope Medium', 65_000],
      ['SMG - Scope Holo', 70_000],
    ],
  },
  {
    id: '2',
    name: 'Categorie 2 - Munitie',
    items: [
      ['Pistol Clip', 500_000],
      ['Shotgun Clip', 550_000],
      ['Smg Clip', 675_000],
      ['Rifle Clip', 700_000],
      ['Smg2 Clip', 750_000],
      ['Rifle2 Clip', 800_000],
      ['Special Ammo', 950_000],
      ['Motion Ammo', 1_000_000],
    ],
  },
  {
    id: '3',
    name: 'Categorie 3 - Wapens',
    items: [
      ['Pistol', 4_200_000],
      ['M1911', 4_300_000],
      ['Beretta', 4_400_000],
      ['Glock 17', 4_500_000],
      ['Meos45', 4_600_000],
      ['MP9', 4_700_000],
      ['Pistol50', 5_000_000],
      ['MP7 Chromium', 5_200_000],
    ],
  },
  {
    id: '4',
    name: 'Categorie 4 - Wapens',
    items: [
      ['Smith & Wesson', 5_200_000],
      ['G19 Grip', 5_400_000],
      ['G19 KMR', 5_600_000],
      ['CZ75', 5_800_000],
      ['Pistol XM3', 6_000_000],
      ['M9P Chromium', 6_200_000],
      ['Pistol Chromium', 6_400_000],
      ['Akv9', 6_800_000],
      ['Tec-9', 7_200_000],
    ],
  },
  {
    id: '5',
    name: 'Categorie 5 - Wapens',
    items: [
      ['M&P 9', 6_800_000],
      ['Wm29 Pistol', 7_000_000],
      ['Revolver', 7_200_000],
      ['Navy Revolver', 7_400_000],
      ['Action Revolver', 7_600_000],
      ['Machine Red Chromium', 7_800_000],
      ['Skorp', 8_000_000],
      ['Micro Smg', 8_200_000],
      ['Mac 11', 8_400_000],
      ['Smg Mk2', 8_600_000],
      ['Uzi', 8_800_000],
      ['UMP45', 10_000_000],
      ['P90', 10_200_000],
    ],
  },
  {
    id: '6',
    name: 'Categorie 6 - Wapens',
    items: [
      ['Remington', 7_600_000],
      ['M870', 8_000_000],
      ['Shotgun Chromium', 8_400_000],
      ['Heavy Shotgun', 8_800_000],
      ['Benellim4', 9_200_000],
      ['Bennlim4 Mk2', 9_600_000],
    ],
  },
  {
    id: '7',
    name: 'Categorie 7 - Wapens',
    items: [
      ['AK Shortstock', 10_000_000],
      ['AK74u', 10_200_000],
      ['Crossp5', 10_400_000],
      ['UMP45 V2', 10_600_000],
      ['MP5', 10_800_000],
      ['Ak47u', 11_000_000],
      ['Ak 47', 11_200_000],
      ['Arc15 Chromium', 11_400_000],
      ['Rust Ak', 11_400_000],
      ['Tactical SMG', 11_700_000],
      ['KNR', 12_000_000],
    ],
  },
  {
    id: '8',
    name: 'Categorie 8 - Wapens',
    items: [
      ['Vector', 13_000_000],
      ['Ak 12', 13_400_000],
      ['Special Carbine', 13_800_000],
      ['AKT', 14_200_000],
      ['Absolute 357', 14_600_000],
      ['Akpu V2', 15_000_000],
      ['Bullpup Rifle Mk2', 15_400_000],
      ['Red Arp', 15_800_000],
      ['Veresk', 16_200_000],
      ['Howat 20', 16_600_000],
      ['Brazil AR', 100_000_000],
      ['DGF9 Orange Line', 100_000_000],
      ['Fnfal', 100_000_000],
      ['Francear', 100_000_000],
      ['Gang Draco', 100_000_000],
      ['M4 Military', 100_000_000],
      ['M4 Pink Rose', 100_000_000],
      ['Morocco AR', 100_000_000],
      ['Netherlands AR', 100_000_000],
      ['Roselink', 100_000_000],
      ['Sg347', 100_000_000],
      ['Turkey AR', 100_000_000],
      ['VT13 Woody', 100_000_000],
    ],
  },
  {
    id: '9',
    name: 'Categorie 9 - Wapens',
    items: [
      ['CZ91', 14_000_000],
      ['AK74 Purplefunk', 15_000_000],
      ['Gold M1911', 16_000_000],
      ['Revolver Whity', 16_000_000],
      ['Groza Chromium', 18_000_000],
      ['PPM Snakebite', 18_000_000],
      ['Beryl 762', 20_000_000],
      ['FNX45 Abstractline', 24_000_000],
      ['FNX45 Thunderbolt', 24_000_000],
      ['Match Pistol', 30_000_000],
      ['Ceramic Pistol', 34_000_000],
      ['Wolf Rifle', 40_000_000],
      ['PPSH1', 50_000_000],
    ],
  },
  {
    id: '10',
    name: 'Categorie 10 - Wapens',
    items: [
      ['Bas P Red', 25_000_000],
      ['Neva', 27_500_000],
      ['Scarv Purplespace', 27_500_000],
      ['SF41 White', 28_000_000],
      ['AK47 Red Chromium', 29_700_000],
      ['MRS47 Radiantstrike', 35_200_000],
      ['FOOLV2 Red', 36_000_000],
      ['NVRIFLE Purple', 36_000_000],
      ['M4A1', 36_300_000],
      ['Type56', 39_600_000],
      ['Violet Vengange', 42_900_000],
      ['AK Cherry Red', 44_000_000],
      ['HWR14', 46_200_000],
      ['Godzilla Scar', 49_500_000],
      ['AK74 Black', 51_150_000],
      ['DGF9 Orange Line', 52_250_000],
      ['Combat MG', 55_000_000],
      ['RRC3 Achromic', 55_000_000],
      ['AK Skull Face', 65_000_000],
      ['HELLCORE', 85_000_000],
      ['MP5 Spider', 100_000_000],
      ['Musket', 220_000_000],
    ],
  },
].map(category => {
  const categoryMaximum =
    DEALER_CATEGORY_MAXIMUMS[category.id];

  if (!Number.isSafeInteger(categoryMaximum)) {
    throw new Error(
      `Maximale straatwaarde ontbreekt voor categorie ${category.id}`,
    );
  }

  return {
    ...category,
    categoryMaximum,
    items: category.items.map(([name, price], index) => ({
      id: `${category.id}-${index + 1}`,
      categoryId: category.id,
      categoryMaximum,
      name,
      price,
    })),
  };
});

const DEALER_ITEMS = new Map(
  DEALER_CATALOG.flatMap(category =>
    category.items.map(item => [item.id, item]),
  ),
);
const dealerSessions = new Map();

// Officiële Hollow Kings-rangen, van hoogste naar laagste rang.
// Deze ene lijst stuurt /ledenlijst, /profiel, punten en ganglidcontroles aan.
const DEFAULT_RANK_ROLE_IDS = Object.freeze([
  '1300970950019383397',
  '1317980086552625203',
  '1357136491389915196',
  '1378846790417383514',
  '1469476258479079485',
  '1433234131281772765',
  '1499427961126785155',
  '1433234275335016458',
  '1499427539389776043',
  '1433234300857487422',
  '1433234303810277487',
]);

const RANK_ROLE_IDS = DEFAULT_RANK_ROLE_IDS;

const parsedMemberLimit = Number.parseInt(
  process.env.GANG_MEMBER_LIMIT ?? '50',
  10,
);
const GANG_MEMBER_LIMIT = Number.isFinite(parsedMemberLimit)
  ? parsedMemberLimit
  : 50;

const sayCommand = new SlashCommandBuilder()
  .setName('zeg')
  .setDescription('Laat de bot een bericht in een kanaal sturen')
  .addChannelOption(option =>
    option
      .setName('kanaal')
      .setDescription('Het kanaal waarin het bericht moet komen')
      .setRequired(true)
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
      ),
  )
  .addStringOption(option =>
    option
      .setName('bericht')
      .setDescription('Het bericht dat de bot moet sturen')
      .setRequired(true)
      .setMaxLength(2000),
  )
  .setContexts(InteractionContextType.Guild);

const memberListCommand = new SlashCommandBuilder()
  .setName('ledenlijst')
  .setDescription('Toont alle gangleden onder hun huidige rang')
  .setContexts(InteractionContextType.Guild);

const memberProfileCommand = new SlashCommandBuilder()
  .setName('profiel')
  .setDescription('Toont het persoonlijke Hollow Kings-profiel van een ganglid')
  .addUserOption(option =>
    option
      .setName('lid')
      .setDescription('Optioneel: bekijk het profiel van een ander ganglid')
      .setRequired(false),
  )
  .setContexts(InteractionContextType.Guild);

const pointsListCommand = new SlashCommandBuilder()
  .setName('puntenlijst')
  .setDescription('Toont privé de actuele punten van alle gangleden')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const pointsTodayCommand = new SlashCommandBuilder()
  .setName('puntenvandaag')
  .setDescription('Plaatst het activiteitenoverzicht van vandaag')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const pointsSubmitCommand = new SlashCommandBuilder()
  .setName('puntenindienen')
  .setDescription('Dien punten in voor een Hollow Kings-activiteit')
  .setContexts(InteractionContextType.Guild);

const pointsCommand = new SlashCommandBuilder()
  .setName('punten')
  .setDescription('Voegt losse punten toe of trekt losse punten af')
  .addUserOption(option =>
    option
      .setName('lid')
      .setDescription('Het ganglid van wie je de punten wijzigt')
      .setRequired(true),
  )
  .addStringOption(option =>
    option
      .setName('actie')
      .setDescription('Kies of je punten toevoegt of aftrekt')
      .setRequired(true)
      .addChoices(
        {
          name: 'Punten toevoegen',
          value: 'toevoegen',
        },
        {
          name: 'Punten aftrekken',
          value: 'aftrekken',
        },
      ),
  )
  .addIntegerOption(option =>
    option
      .setName('aantal')
      .setDescription('Het aantal losse punten')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(10_000),
  )
  .addStringOption(option =>
    option
      .setName('reden')
      .setDescription('Optionele reden voor deze puntenwijziging')
      .setRequired(false)
      .setMaxLength(500),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const pointsResetCommand = new SlashCommandBuilder()
  .setName('puntenreset')
  .setDescription('Reset alle punten en puntenmijlpalen')
  .addStringOption(option =>
    option
      .setName('bevestiging')
      .setDescription('Bevestig dat alle huidige punten mogen worden gewist')
      .setRequired(true)
      .addChoices({
        name: 'Ja, reset alle punten',
        value: 'RESET_ALLES',
      }),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const applicationsOpenCommand = new SlashCommandBuilder()
  .setName('sollicitatietrue')
  .setDescription('Plaatst de vaste melding dat de Hollow Kings-sollicitaties open zijn')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const applicationsClosedCommand = new SlashCommandBuilder()
  .setName('sollicitatiefalse')
  .setDescription('Plaatst de vaste melding dat de Hollow Kings-sollicitaties dicht zijn')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const plukOpenCommand = new SlashCommandBuilder()
  .setName('plukopen')
  .setDescription('Zet de verwerkstatus op open')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const plukClosedCommand = new SlashCommandBuilder()
  .setName('plukdicht')
  .setDescription('Zet de verwerkstatus op gesloten')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const weaponDealerCommand = new SlashCommandBuilder()
  .setName('wapendealer')
  .setDescription('Maakt een wapenbestelling en berekent de totale prijs')
  .addUserOption(option =>
    option
      .setName('klant')
      .setDescription('De persoon die de bestelling koopt')
      .setRequired(true),
  )
  .setContexts(InteractionContextType.Guild);

const absenceCommand = new SlashCommandBuilder()
  .setName('afwezig')
  .setDescription('Dient een afwezigheidsaanvraag in bij het beheer')
  .setContexts(InteractionContextType.Guild);

const processingRequestCommand = new SlashCommandBuilder()
  .setName('aanvraag')
  .setDescription('Opent het formulier voor een verwerkaanvraag')
  .setContexts(InteractionContextType.Guild);

const announcementCommand = new SlashCommandBuilder()
  .setName('mededeling')
  .setDescription('Opent het formulier voor een mededeling met rolping')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const ruleCommand = new SlashCommandBuilder()
  .setName('regel')
  .setDescription('Opent het formulier om een regel met rolping te plaatsen')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const dismissalCommand = new SlashCommandBuilder()
  .setName('ontslag')
  .setDescription('Opent het formulier om een lid te ontslaan')
  .setContexts(InteractionContextType.Guild);

const giveWarnCommand = new SlashCommandBuilder()
  .setName('geefwarn')
  .setDescription('Geeft een officiële warnrol aan een lid')
  .setContexts(InteractionContextType.Guild);

const removeWarnCommand = new SlashCommandBuilder()
  .setName('warnweg')
  .setDescription('Verwijdert een warnrol van een lid')
  .setContexts(InteractionContextType.Guild);

const giveawayCommand = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Opent het uitgebreide Hollow Kings-giveawayformulier')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const giveawayWinnerCommand = new SlashCommandBuilder()
  .setName('giveawaywinnaar')
  .setDescription('Kiest handmatig winnaar(s) van een actieve giveaway')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const dashboardCommand = new SlashCommandBuilder()
  .setName('dashboard')
  .setDescription('Plaatst, vernieuwt of verwijdert het live Hollow Kings-dashboard')
  .addStringOption(option =>
    option
      .setName('actie')
      .setDescription('Standaard wordt het dashboard geplaatst of vernieuwd')
      .setRequired(false)
      .addChoices(
        {
          name: 'Plaatsen of vernieuwen',
          value: 'plaatsen',
        },
        {
          name: 'Dashboard verwijderen',
          value: 'verwijderen',
        },
      ),
  )
  .addChannelOption(option =>
    option
      .setName('kanaal')
      .setDescription('Optioneel: het kanaal voor het dashboard')
      .setRequired(false)
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const cooldownCommand = new SlashCommandBuilder()
  .setName('cooldown')
  .setDescription('Start de gezamenlijke overvalcooldown van 45 minuten')
  .setContexts(InteractionContextType.Guild);

const cancelCooldownCommand = new SlashCommandBuilder()
  .setName('cancelcooldown')
  .setDescription('Annuleert de actieve overvalcooldown')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const eventCommand = new SlashCommandBuilder()
  .setName('evenement')
  .setDescription('Opent het formulier voor een nieuw Hollow Kings-evenement')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const cancelEventCommand = new SlashCommandBuilder()
  .setName('evenementannuleer')
  .setDescription('Opent een keuzemenu om een evenement te annuleren')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

const robinBackupCommand = new SlashCommandBuilder()
  .setName('robinbackup')
  .setDescription('Maakt een uitgebreide veilige back-up van deze server')
  .setContexts(InteractionContextType.Guild);

const robinBackupRestoreCommand = new SlashCommandBuilder()
  .setName('robinonlybackupload')
  .setDescription('Herstelt veilig een Robin-serverback-up')
  .addStringOption(option =>
    option
      .setName('bevestiging')
      .setDescription('Bevestig dat je deze server wilt herstellen')
      .setRequired(true)
      .addChoices({
        name: 'Ja, herstel de back-up veilig',
        value: 'ROBIN_HERSTEL',
      }),
  )
  .addAttachmentOption(option =>
    option
      .setName('bestand')
      .setDescription('Optioneel: een .json- of .json.gz-back-upbestand')
      .setRequired(false),
  )
  .addStringOption(option =>
    option
      .setName('backup_naam')
      .setDescription('Optioneel: naam van een opgeslagen Railway-back-up')
      .setRequired(false)
      .setMaxLength(160),
  )
  .setContexts(InteractionContextType.Guild);

if (!process.env.DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN ontbreekt in .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
  ],
});

// Deze bot gebruikt bewust losse handlers per slash-command en logcategorie.
client.setMaxListeners(50);

const COLORS = {
  messages: 0xFEE75C,
  moderation: 0xED4245,
  members: 0x57F287,
  roles: 0x9B59B6,
  server: 0x5865F2,
  voice: 0x1ABC9C,
  points: 0xF1C40F,
  pointsActivity: 0x57F287,
  giveaway: 0xD4AF37,
  events: 0xD4AF37,
  pluk: 0xF1C40F,
  absence: 0xF1C40F,
  warnings: 0xF1C40F,
  dismissals: 0xED4245,
};

let pointsData = {
  version: POINTS_DATA_VERSION,
  startedAt: Date.now(),
  guildStartedAt: {},
  messages: {},
  manualPoints: {},
  achievements: {},
  dailyPoints: {},
};
let pointsStoreReady = false;
let pointsWriteQueue = Promise.resolve();
const pointsAchievementInProgress = new Set();
const manualPointsUpdateInProgress = new Set();
let pointsDailyRolloverTimer = null;
let absenceData = {
  version: 1,
  approved: {},
};
let absenceStoreReady = false;
let absenceWriteQueue = Promise.resolve();
let absenceExpiryCheckRunning = false;
let processingReminderData = {
  version: 1,
  pending: {},
};
let processingReminderStoreReady = false;
let processingReminderWriteQueue = Promise.resolve();
let processingReminderCheckRunning = false;
let giveawayData = {
  version: 1,
  active: {},
};
let giveawayStoreReady = false;
let giveawayWriteQueue = Promise.resolve();
let giveawayCheckRunning = false;
const giveawayDrafts = new Map();
const giveawayLocks = new Set();
let communityData = {
  version: 2,
  dashboards: {},
  events: {},
  cooldowns: {},
};
let communityStoreReady = false;
let communityWriteQueue = Promise.resolve();
let communityCheckRunning = false;
const dashboardRefreshInProgress = new Set();
const eventDrafts = new Map();
const eventLocks = new Set();
const cooldownLocks = new Set();
const cooldownTimers = new Map();
const serverBackupLocks = new Set();
const serverRestoreLocks = new Set();

function parsePointsFromMessage(content) {
  const match = String(content ?? '').match(/\b(\d{1,4})\s*punten?\b/i);
  if (!match) return null;

  const points = Number.parseInt(match[1], 10);
  return Number.isInteger(points) && points > 0 ? points : null;
}

const pointsDatePartsFormatter = new Intl.DateTimeFormat(
  'en-GB',
  {
    timeZone: POINTS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  },
);
const pointsDisplayDateFormatter = new Intl.DateTimeFormat(
  'nl-NL',
  {
    timeZone: POINTS_TIME_ZONE,
    dateStyle: 'full',
  },
);

function getPointsDateKey(timestamp = Date.now()) {
  const parts = Object.fromEntries(
    pointsDatePartsFormatter
      .formatToParts(new Date(timestamp))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getPointsDayStart(timestamp = Date.now()) {
  const dateKey = getPointsDateKey(timestamp);
  let lowerBound = timestamp - 30 * 60 * 60 * 1000;
  let upperBound = timestamp;

  while (getPointsDateKey(lowerBound) === dateKey) {
    lowerBound -= 12 * 60 * 60 * 1000;
  }

  while (upperBound - lowerBound > 1) {
    const middle = Math.floor((lowerBound + upperBound) / 2);

    if (getPointsDateKey(middle) === dateKey) {
      upperBound = middle;
    } else {
      lowerBound = middle;
    }
  }

  return upperBound;
}

function getNextPointsDayStart(timestamp = Date.now()) {
  const dateKey = getPointsDateKey(timestamp);
  let lowerBound = timestamp;
  let upperBound = timestamp + 30 * 60 * 60 * 1000;

  while (getPointsDateKey(upperBound) === dateKey) {
    upperBound += 12 * 60 * 60 * 1000;
  }

  while (upperBound - lowerBound > 1) {
    const middle = Math.floor((lowerBound + upperBound) / 2);

    if (getPointsDateKey(middle) === dateKey) {
      lowerBound = middle;
    } else {
      upperBound = middle;
    }
  }

  return upperBound;
}

function createDailyPointsRecord(
  timestamp = Date.now(),
  { backfillCompleted = false } = {},
) {
  return {
    dateKey: getPointsDateKey(timestamp),
    startedAt: getPointsDayStart(timestamp),
    users: {},
    reactions: {},
    manualEvents: {},
    activities: {},
    backfillCompletedAt: backfillCompleted
      ? new Date(timestamp).toISOString()
      : null,
    activityBackfillCompletedAt: backfillCompleted
      ? new Date(timestamp).toISOString()
      : null,
    activityTypesVersion: POINTS_ACTIVITY_TYPES_VERSION,
  };
}

function ensureDailyPointsRecord(
  guildId,
  timestamp = Date.now(),
  { markBackfillCompleted = false } = {},
) {
  pointsData.dailyPoints ??= {};
  const dateKey = getPointsDateKey(timestamp);
  let record = pointsData.dailyPoints[guildId];
  let changed = false;

  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    record.dateKey !== dateKey
  ) {
    record = createDailyPointsRecord(timestamp, {
      backfillCompleted: markBackfillCompleted,
    });
    pointsData.dailyPoints[guildId] = record;
    changed = true;
  }

  for (
    const key of
    ['users', 'reactions', 'manualEvents', 'activities']
  ) {
    if (
      !record[key] ||
      typeof record[key] !== 'object' ||
      Array.isArray(record[key])
    ) {
      record[key] = {};
      changed = true;
    }
  }

  if (!Number.isFinite(record.startedAt)) {
    record.startedAt = getPointsDayStart(timestamp);
    changed = true;
  }

  if (!('backfillCompletedAt' in record)) {
    record.backfillCompletedAt = null;
    changed = true;
  }

  if (!('activityBackfillCompletedAt' in record)) {
    record.activityBackfillCompletedAt = null;
    changed = true;
  }

  if (
    record.activityTypesVersion !==
    POINTS_ACTIVITY_TYPES_VERSION
  ) {
    record.activityTypesVersion =
      POINTS_ACTIVITY_TYPES_VERSION;
    record.activityBackfillCompletedAt = null;
    changed = true;
  }

  return { record, changed };
}

function getDailyPointsUserRecord(record, userId) {
  const existing = record.users[userId];

  if (
    existing &&
    typeof existing === 'object' &&
    !Array.isArray(existing)
  ) {
    existing.reactionPoints = Number.isSafeInteger(
      existing.reactionPoints,
    )
      ? Math.max(0, existing.reactionPoints)
      : 0;
    existing.manualPoints = Number.isSafeInteger(
      existing.manualPoints,
    )
      ? existing.manualPoints
      : 0;
    return existing;
  }

  const userRecord = {
    reactionPoints: 0,
    manualPoints: 0,
  };
  record.users[userId] = userRecord;
  return userRecord;
}

function removeEmptyDailyPointsUser(record, userId) {
  const userRecord = record.users[userId];

  if (
    userRecord &&
    userRecord.reactionPoints === 0 &&
    userRecord.manualPoints === 0
  ) {
    delete record.users[userId];
  }
}

function setDailyReactionAward({
  guildId,
  messageId,
  userId,
  points,
  timestamp = Date.now(),
  markBackfillCompleted = true,
}) {
  const ensured = ensureDailyPointsRecord(
    guildId,
    timestamp,
    { markBackfillCompleted },
  );
  const { record } = ensured;

  if (!Number.isSafeInteger(points) || points <= 0) {
    return ensured.changed;
  }

  record.reactions[messageId] ??= {};
  const previousPoints = Number.isSafeInteger(
    record.reactions[messageId][userId],
  )
    ? record.reactions[messageId][userId]
    : 0;

  if (previousPoints === points) return ensured.changed;

  record.reactions[messageId][userId] = points;
  const userRecord = getDailyPointsUserRecord(record, userId);
  userRecord.reactionPoints = Math.max(
    0,
    userRecord.reactionPoints + points - previousPoints,
  );
  return true;
}

function removeDailyReactionAward({
  guildId,
  messageId,
  userId,
  timestamp = Date.now(),
}) {
  const ensured = ensureDailyPointsRecord(
    guildId,
    timestamp,
    { markBackfillCompleted: true },
  );
  const { record } = ensured;
  const messageAwards = record.reactions[messageId];
  const points = messageAwards?.[userId];

  if (!Number.isSafeInteger(points) || points <= 0) {
    return ensured.changed;
  }

  delete messageAwards[userId];
  if (!Object.keys(messageAwards).length) {
    delete record.reactions[messageId];
  }

  const userRecord = getDailyPointsUserRecord(record, userId);
  userRecord.reactionPoints = Math.max(
    0,
    userRecord.reactionPoints - points,
  );
  removeEmptyDailyPointsUser(record, userId);
  return true;
}

function removeDailyReactionAwardsForMessage({
  guildId,
  messageId,
  timestamp = Date.now(),
}) {
  const ensured = ensureDailyPointsRecord(
    guildId,
    timestamp,
    { markBackfillCompleted: true },
  );
  const { record } = ensured;
  const messageAwards = record.reactions[messageId];

  if (!messageAwards || typeof messageAwards !== 'object') {
    return ensured.changed;
  }

  for (const [userId, points] of Object.entries(messageAwards)) {
    if (!Number.isSafeInteger(points) || points <= 0) continue;

    const userRecord = getDailyPointsUserRecord(record, userId);
    userRecord.reactionPoints = Math.max(
      0,
      userRecord.reactionPoints - points,
    );
    removeEmptyDailyPointsUser(record, userId);
  }

  delete record.reactions[messageId];
  return true;
}

function updateDailyReactionAwardsForMessage({
  guildId,
  messageId,
  points,
  timestamp = Date.now(),
}) {
  const ensured = ensureDailyPointsRecord(
    guildId,
    timestamp,
    { markBackfillCompleted: true },
  );
  const { record } = ensured;
  const messageAwards = record.reactions[messageId];

  if (
    !messageAwards ||
    typeof messageAwards !== 'object' ||
    !Number.isSafeInteger(points) ||
    points <= 0
  ) {
    return ensured.changed;
  }

  let changed = ensured.changed;

  for (const [userId, previousPoints] of Object.entries(messageAwards)) {
    if (
      !Number.isSafeInteger(previousPoints) ||
      previousPoints <= 0 ||
      previousPoints === points
    ) {
      continue;
    }

    const userRecord = getDailyPointsUserRecord(record, userId);
    userRecord.reactionPoints = Math.max(
      0,
      userRecord.reactionPoints + points - previousPoints,
    );
    messageAwards[userId] = points;
    changed = true;
  }

  return changed;
}

function applyDailyManualPointsChange({
  guildId,
  userId,
  change,
  eventId,
  timestamp = Date.now(),
  markBackfillCompleted = true,
}) {
  const ensured = ensureDailyPointsRecord(
    guildId,
    timestamp,
    { markBackfillCompleted },
  );
  const { record } = ensured;
  const safeEventId = String(
    eventId || `manual-${timestamp}-${randomUUID()}`,
  );

  if (
    !Number.isSafeInteger(change) ||
    change === 0 ||
    record.manualEvents[safeEventId]
  ) {
    return ensured.changed;
  }

  const userRecord = getDailyPointsUserRecord(record, userId);
  userRecord.manualPoints += change;
  record.manualEvents[safeEventId] = {
    userId,
    change,
    occurredAt: timestamp,
  };
  removeEmptyDailyPointsUser(record, userId);
  return true;
}

function calculateDailyPointsTotals(
  guildId,
  timestamp = Date.now(),
) {
  const { record } = ensureDailyPointsRecord(
    guildId,
    timestamp,
  );
  const totals = new Map();

  for (const [userId, savedRecord] of Object.entries(record.users)) {
    const userRecord = getDailyPointsUserRecord(
      record,
      userId,
    );
    const total = Math.max(
      0,
      userRecord.reactionPoints + userRecord.manualPoints,
    );

    if (total > 0) totals.set(userId, total);
  }

  return totals;
}

function parsePointsActivityType(content) {
  const text = String(content ?? '');

  for (const type of POINTS_ACTIVITY_TYPE_KEYS) {
    if (POINTS_SUBMISSION_TYPES[type].matcher.test(text)) {
      return type;
    }
  }

  return null;
}

function syncDailyPointsActivity({
  guildId,
  message,
  timestamp = Date.now(),
  markBackfillCompleted = true,
}) {
  const ensured = ensureDailyPointsRecord(
    guildId,
    timestamp,
    { markBackfillCompleted },
  );
  const { record } = ensured;
  const messageTimestamp = getMessageTimestamp(message) ?? timestamp;
  const activityType = parsePointsActivityType(message.content);
  const points = parsePointsFromMessage(message.content);
  const isCurrentDay =
    getPointsDateKey(messageTimestamp) === record.dateKey;
  const existing = record.activities[message.id];

  if (!isCurrentDay || !activityType || !points) {
    if (existing) {
      delete record.activities[message.id];
      return true;
    }

    return ensured.changed;
  }

  const activity = {
    type: activityType,
    points,
    channelId: message.channelId ?? POINTS_SOURCE_CHANNEL_ID,
    messageId: message.id,
    createdAt: messageTimestamp,
    label: shorten(
      String(message.content ?? '')
        .split(/\r?\n/)
        .find(line => line.trim()) ?? activityType,
      120,
    ),
  };

  if (
    existing?.type === activity.type &&
    existing?.points === activity.points &&
    existing?.channelId === activity.channelId &&
    existing?.createdAt === activity.createdAt &&
    existing?.label === activity.label
  ) {
    return ensured.changed;
  }

  record.activities[message.id] = activity;
  return true;
}

function removeDailyPointsActivity({
  guildId,
  messageId,
  timestamp = Date.now(),
}) {
  const ensured = ensureDailyPointsRecord(
    guildId,
    timestamp,
    { markBackfillCompleted: true },
  );
  const { record } = ensured;

  if (!record.activities[messageId]) {
    return ensured.changed;
  }

  delete record.activities[messageId];
  return true;
}

function summarizeDailyPointsActivities(
  guildId,
  timestamp = Date.now(),
) {
  const { record } = ensureDailyPointsRecord(
    guildId,
    timestamp,
  );
  const summary = {
    ...Object.fromEntries(
      POINTS_ACTIVITY_TYPE_KEYS.map(type => [
        type,
        { count: 0, points: 0 },
      ]),
    ),
    totalCount: 0,
    totalPoints: 0,
  };

  for (const activity of Object.values(record.activities)) {
    if (
      !activity ||
      !POINTS_ACTIVITY_TYPE_KEYS.includes(activity.type) ||
      !Number.isSafeInteger(activity.points) ||
      activity.points <= 0
    ) {
      continue;
    }

    summary[activity.type].count += 1;
    summary[activity.type].points += activity.points;
    summary.totalCount += 1;
    summary.totalPoints += activity.points;
  }

  return summary;
}

function getMessageTimestamp(message) {
  if (Number.isFinite(message?.createdTimestamp)) {
    return message.createdTimestamp;
  }

  const createdAt = message?.createdAt;
  return createdAt instanceof Date
    ? createdAt.getTime()
    : null;
}

async function fetchMessagesSince(channel, startedAt) {
  if (typeof channel?.messages?.fetch !== 'function') {
    throw new Error('berichtgeschiedenis is niet beschikbaar');
  }

  const collected = [];
  let before;

  for (
    let page = 0;
    page < POINTS_DAILY_BACKFILL_PAGE_LIMIT;
    page += 1
  ) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    const messages = [...fetched.values()];

    if (!messages.length) break;

    collected.push(
      ...messages.filter(message => {
        const timestamp = getMessageTimestamp(message);
        return timestamp !== null && timestamp >= startedAt;
      }),
    );

    const oldestMessage = messages.reduce((oldest, message) => {
      const timestamp = getMessageTimestamp(message) ?? Infinity;
      const oldestTimestamp =
        getMessageTimestamp(oldest) ?? Infinity;
      return timestamp < oldestTimestamp ? message : oldest;
    });
    const oldestTimestamp = getMessageTimestamp(oldestMessage);
    before = oldestMessage.id;

    if (
      messages.length < 100 ||
      !before ||
      oldestTimestamp === null ||
      oldestTimestamp < startedAt
    ) {
      break;
    }
  }

  return collected.sort(
    (messageA, messageB) =>
      (getMessageTimestamp(messageA) ?? 0) -
      (getMessageTimestamp(messageB) ?? 0),
  );
}

function parseManualPointsLog(message, botId) {
  if (botId && message.author?.id !== botId) return null;

  const embed = message.embeds?.[0];
  const title = embed?.title ?? embed?.data?.title;

  if (
    title !== 'Losse punten toegevoegd' &&
    title !== 'Losse punten afgetrokken'
  ) {
    return null;
  }

  const fields = embed.fields ?? embed.data?.fields ?? [];
  const memberField = fields.find(field => field.name === 'Lid');
  const changeField = fields.find(field => field.name === 'Wijziging');
  const userIdMatch = String(memberField?.value ?? '').match(
    /(?:<@!?(\d{15,22})>|\((\d{15,22})\))/, 
  );
  const changeMatch = String(changeField?.value ?? '').match(
    /([+-])\s*(\d{1,6})\s*punten?/i,
  );

  if (!userIdMatch || !changeMatch) return null;

  const amount = Number.parseInt(changeMatch[2], 10);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;

  return {
    userId: userIdMatch[1] ?? userIdMatch[2],
    change: changeMatch[1] === '-' ? -amount : amount,
  };
}

async function backfillDailyPointsForGuild(guild) {
  const now = Date.now();
  const ensured = ensureDailyPointsRecord(guild.id, now);
  const { record } = ensured;
  const needsMemberBackfill = !record.backfillCompletedAt;
  const needsActivityBackfill =
    !record.activityBackfillCompletedAt;
  const resetAtTimestamp = Date.parse(record.resetAt ?? '');
  const activityBackfillStartedAt = Number.isFinite(
    resetAtTimestamp,
  )
    ? Math.max(record.startedAt, resetAtTimestamp)
    : record.startedAt;

  if (!needsMemberBackfill && !needsActivityBackfill) {
    if (ensured.changed) await queuePointsSave();
    return;
  }

  let reactionAwards = 0;
  let manualEvents = 0;
  let activities = 0;
  let sourceStatus = 'niet ingesteld';
  let manualStatus = 'niet ingesteld';

  if (POINTS_SOURCE_CHANNEL_ID) {
    const sourceChannel =
      guild.channels.cache.get(POINTS_SOURCE_CHANNEL_ID) ??
      (await guild.channels
        .fetch(POINTS_SOURCE_CHANNEL_ID)
        .catch(() => null));

    if (sourceChannel) {
      try {
        const messages = await fetchMessagesSince(
          sourceChannel,
          record.startedAt,
        );

        for (const message of messages) {
          if (
            needsActivityBackfill &&
            (getMessageTimestamp(message) ?? now) >=
              activityBackfillStartedAt
          ) {
            const alreadyTracked = Boolean(
              record.activities[message.id],
            );
            const changed = syncDailyPointsActivity({
              guildId: guild.id,
              message,
              timestamp: now,
              markBackfillCompleted: false,
            });

            if (changed && !alreadyTracked) {
              activities += 1;
            }
          }

          if (!needsMemberBackfill) continue;

          const entry = getPointsEntry(message.id);

          if (
            !entry ||
            entry.guildId !== guild.id ||
            !Number.isSafeInteger(entry.points) ||
            entry.points <= 0
          ) {
            continue;
          }

          entry.messageCreatedAt = getMessageTimestamp(message);

          for (
            const [userId, reactions] of
            Object.entries(entry.users ?? {})
          ) {
            if (!Array.isArray(reactions) || !reactions.length) {
              continue;
            }

            const alreadyTracked = Boolean(
              record.reactions[message.id]?.[userId],
            );
            setDailyReactionAward({
              guildId: guild.id,
              messageId: message.id,
              userId,
              points: entry.points,
              timestamp: now,
              markBackfillCompleted: false,
            });
            if (!alreadyTracked) reactionAwards += 1;
          }
        }

        sourceStatus = 'voltooid';
      } catch (error) {
        sourceStatus = `mislukt: ${error.message}`;
        console.warn(
          `Dagpunten uit puntenkanaal ${guild.id} teruglezen ` +
          `mislukt: ${error.message}`,
        );
      }
    } else {
      sourceStatus = 'kanaal niet bereikbaar';
    }
  }

  const activityLogChannelId = needsMemberBackfill
    ? LOG_CHANNELS.pointsActivity
    : null;

  if (activityLogChannelId) {
    const activityLogChannel =
      guild.channels.cache.get(activityLogChannelId) ??
      (await guild.channels
        .fetch(activityLogChannelId)
        .catch(() => null));

    if (activityLogChannel) {
      try {
        const messages = await fetchMessagesSince(
          activityLogChannel,
          record.startedAt,
        );
        const botId = guild.members.me?.id ?? client.user?.id;

        for (const message of messages) {
          const parsed = parseManualPointsLog(message, botId);
          if (!parsed) continue;

          const eventId = `log-${message.id}`;
          const alreadyTracked = Boolean(
            record.manualEvents[eventId],
          );
          applyDailyManualPointsChange({
            guildId: guild.id,
            userId: parsed.userId,
            change: parsed.change,
            eventId,
            timestamp: getMessageTimestamp(message) ?? now,
            markBackfillCompleted: false,
          });
          if (!alreadyTracked) manualEvents += 1;
        }

        manualStatus = 'voltooid';
      } catch (error) {
        manualStatus = `mislukt: ${error.message}`;
        console.warn(
          `Dagpunten uit puntenlogs ${guild.id} teruglezen ` +
          `mislukt: ${error.message}`,
        );
      }
    } else {
      manualStatus = 'kanaal niet bereikbaar';
    }
  }

  if (needsMemberBackfill) {
    record.backfillCompletedAt = new Date(now).toISOString();
    record.backfill = {
      reactionAwards,
      manualEvents,
      sourceStatus,
      manualStatus,
    };
  }

  if (needsActivityBackfill) {
    record.activityBackfillCompletedAt =
      new Date(now).toISOString();
    record.activityBackfill = {
      activities,
      sourceStatus,
    };
  }
  await queuePointsSave();

  console.log(
    `Dagoverzicht ${guild.name}: ${activities} activiteit(en), ` +
    `${reactionAwards} reactiebeloning(en) en ${manualEvents} ` +
    `handmatige wijziging(en) van vandaag meegenomen.`,
  );
}

async function processDailyPointsRollover(discordClient) {
  if (!pointsStoreReady) return;

  let changed = false;
  const now = Date.now();

  for (const guild of discordClient.guilds.cache.values()) {
    const ensured = ensureDailyPointsRecord(
      guild.id,
      now,
      { markBackfillCompleted: true },
    );
    changed ||= ensured.changed;
  }

  if (changed) {
    await queuePointsSave();
    console.log(
      `Dagpunten automatisch gereset voor ${getPointsDateKey(now)}.`,
    );
  }
}

function scheduleDailyPointsRollover(discordClient) {
  if (pointsDailyRolloverTimer) {
    clearTimeout(pointsDailyRolloverTimer);
  }

  const now = Date.now();
  const delay = Math.max(
    1000,
    getNextPointsDayStart(now) - now +
      POINTS_DAILY_ROLLOVER_BUFFER_MS,
  );

  pointsDailyRolloverTimer = setTimeout(async () => {
    try {
      await processDailyPointsRollover(discordClient);
    } catch (error) {
      console.error(
        'Automatische reset van dagpunten mislukt:',
        error.message,
      );
    } finally {
      scheduleDailyPointsRollover(discordClient);
    }
  }, delay);
  pointsDailyRolloverTimer.unref?.();
}

function memberHasGangRole(member) {
  const roles = member?.roles;

  if (roles?.cache && typeof roles.cache.has === 'function') {
    return RANK_ROLE_IDS.some(roleId => roles.cache.has(roleId));
  }

  return (
    Array.isArray(roles) &&
    RANK_ROLE_IDS.some(roleId => roles.includes(roleId))
  );
}

function memberHasRole(member, roleId) {
  const roles = member?.roles;

  if (roles?.cache && typeof roles.cache.has === 'function') {
    return roles.cache.has(roleId);
  }

  return Array.isArray(roles) && roles.includes(roleId);
}

function memberCanUseRobinBackup(member) {
  return memberHasRole(member, ROBIN_BACKUP_ROLE_ID);
}

function memberCanUseCooldown(member, memberPermissions) {
  return (
    memberHasGangRole(member) ||
    memberHasRole(member, COOLDOWN_ROLE_ID) ||
    memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    ) === true
  );
}

function createEmptyPointsData() {
  return {
    version: POINTS_DATA_VERSION,
    startedAt: Date.now(),
    guildStartedAt: {},
    messages: {},
    manualPoints: {},
    achievements: {},
    dailyPoints: {},
  };
}

async function writePointsData(snapshot) {
  await mkdir(dirname(POINTS_DATA_FILE), { recursive: true });

  const temporaryFile = `${POINTS_DATA_FILE}.${process.pid}.tmp`;
  await writeFile(temporaryFile, snapshot, 'utf8');
  await rename(temporaryFile, POINTS_DATA_FILE);
}

function queuePointsSave() {
  const snapshot = JSON.stringify(pointsData, null, 2);

  pointsWriteQueue = pointsWriteQueue
    .catch(() => {})
    .then(() => writePointsData(snapshot));

  return pointsWriteQueue;
}

async function initializePointsStore() {
  await mkdir(dirname(POINTS_DATA_FILE), { recursive: true });

  try {
    const savedData = JSON.parse(
      await readFile(POINTS_DATA_FILE, 'utf8'),
    );

    if (
      !savedData ||
      typeof savedData !== 'object' ||
      typeof savedData.startedAt !== 'number' ||
      !savedData.messages ||
      typeof savedData.messages !== 'object' ||
      Array.isArray(savedData.messages)
    ) {
      throw new Error('ongeldig gegevensformaat');
    }

    pointsData = {
      version: POINTS_DATA_VERSION,
      startedAt: savedData.startedAt,
      guildStartedAt:
        savedData.guildStartedAt &&
        typeof savedData.guildStartedAt === 'object' &&
        !Array.isArray(savedData.guildStartedAt)
          ? savedData.guildStartedAt
          : {},
      messages: savedData.messages,
      manualPoints:
        savedData.manualPoints &&
        typeof savedData.manualPoints === 'object' &&
        !Array.isArray(savedData.manualPoints)
          ? savedData.manualPoints
          : {},
      achievements:
        savedData.achievements &&
        typeof savedData.achievements === 'object' &&
        !Array.isArray(savedData.achievements)
          ? savedData.achievements
          : {},
      dailyPoints:
        savedData.dailyPoints &&
        typeof savedData.dailyPoints === 'object' &&
        !Array.isArray(savedData.dailyPoints)
          ? savedData.dailyPoints
          : {},
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(
        `Puntenbestand kon niet worden gelezen: ${error.message}`,
      );
    }

    pointsData = createEmptyPointsData();
    await writePointsData(JSON.stringify(pointsData, null, 2));
  }

  pointsStoreReady = true;

  if (
    process.env.RAILWAY_ENVIRONMENT_ID &&
    !process.env.RAILWAY_VOLUME_MOUNT_PATH
  ) {
    console.warn(
      'WAARSCHUWING: geen Railway-volume gekoppeld. ' +
      'Punten kunnen bij een deployment verdwijnen.',
    );
  }

  console.log(`Puntenopslag actief: ${POINTS_DATA_FILE}`);

  if (!POINTS_ACHIEVEMENT_CHANNEL_ID) {
    console.warn(
      'WAARSCHUWING: POINTS_ACHIEVEMENT_CHANNEL_ID ontbreekt. ' +
      'De 50/100/150-puntenmijlpalen kunnen niet worden verstuurd.',
    );
  }
}

function createEmptyAbsenceData() {
  return {
    version: 1,
    approved: {},
  };
}

async function writeAbsenceData(snapshot) {
  await mkdir(dirname(ABSENCE_DATA_FILE), { recursive: true });

  const temporaryFile =
    `${ABSENCE_DATA_FILE}.${process.pid}.tmp`;
  await writeFile(temporaryFile, snapshot, 'utf8');
  await rename(temporaryFile, ABSENCE_DATA_FILE);
}

function queueAbsenceSave() {
  const snapshot = JSON.stringify(absenceData, null, 2);

  absenceWriteQueue = absenceWriteQueue
    .catch(() => {})
    .then(() => writeAbsenceData(snapshot));

  return absenceWriteQueue;
}

async function initializeAbsenceStore() {
  await mkdir(dirname(ABSENCE_DATA_FILE), { recursive: true });

  try {
    const savedData = JSON.parse(
      await readFile(ABSENCE_DATA_FILE, 'utf8'),
    );

    if (
      !savedData ||
      typeof savedData !== 'object' ||
      !savedData.approved ||
      typeof savedData.approved !== 'object' ||
      Array.isArray(savedData.approved)
    ) {
      throw new Error('ongeldig gegevensformaat');
    }

    absenceData = {
      version: 1,
      approved: savedData.approved,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(
        `Afwezigheidsbestand kon niet worden gelezen: ${error.message}`,
      );
    }

    absenceData = createEmptyAbsenceData();
    await writeAbsenceData(
      JSON.stringify(absenceData, null, 2),
    );
  }

  absenceStoreReady = true;
  console.log(`Afwezigheidsopslag actief: ${ABSENCE_DATA_FILE}`);

  if (
    process.env.RAILWAY_ENVIRONMENT_ID &&
    !process.env.RAILWAY_VOLUME_MOUNT_PATH
  ) {
    console.warn(
      'WAARSCHUWING: geen Railway-volume gekoppeld. ' +
      'Afwezigheidseinddatums kunnen bij een deployment verdwijnen.',
    );
  }

  if (!ABSENCE_ROLE_ID) {
    console.warn(
      'WAARSCHUWING: ABSENCE_ROLE_ID ontbreekt. ' +
      'Goedgekeurde afwezigheden kunnen nog geen rol krijgen.',
    );
  }
}

function getAmsterdamCalendarDate(date = new Date()) {
  const dateParts = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(
    dateParts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number.parseInt(part.value, 10)]),
  );

  return {
    day: values.day,
    month: values.month,
    year: values.year,
  };
}

function calendarDateNumber({ day, month, year }) {
  return year * 10_000 + month * 100 + day;
}

function getStoredAbsenceEndDate(record) {
  const day = Number.parseInt(record?.endDate?.day, 10);
  const month = Number.parseInt(record?.endDate?.month, 10);
  const year = Number.parseInt(record?.endDate?.year, 10);
  const parsed = parseAbsenceDate(`${day}-${month}-${year}`);

  return parsed;
}

function getStoredAbsenceStartDate(record) {
  const day = Number.parseInt(record?.startDate?.day, 10);
  const month = Number.parseInt(record?.startDate?.month, 10);
  const year = Number.parseInt(record?.startDate?.year, 10);

  return parseAbsenceDate(`${day}-${month}-${year}`);
}

function hasAbsenceEndDatePassed(
  endDate,
  now = new Date(),
) {
  return (
    calendarDateNumber(getAmsterdamCalendarDate(now)) >
    calendarDateNumber(endDate)
  );
}

function absenceRecordKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

async function processExpiredAbsences(discordClient) {
  if (!absenceStoreReady || absenceExpiryCheckRunning) return;

  absenceExpiryCheckRunning = true;
  let dataChanged = false;

  try {
    for (
      const [recordKey, record] of
      Object.entries(absenceData.approved)
    ) {
      const endDate = getStoredAbsenceEndDate(record);
      const startDate = getStoredAbsenceStartDate(record);

      if (
        !record?.guildId ||
        !record?.userId ||
        !record?.roleId ||
        !endDate
      ) {
        delete absenceData.approved[recordKey];
        dataChanged = true;
        continue;
      }

      if (!hasAbsenceEndDatePassed(endDate)) continue;

      const guild =
        discordClient.guilds.cache.get(record.guildId) ??
        (await discordClient.guilds
          .fetch(record.guildId)
          .catch(() => null));

      if (!guild) {
        console.error(
          `Server ${record.guildId} niet gevonden voor verlopen ` +
          'afwezigheid.',
        );
        continue;
      }

      const member =
        guild.members.cache.get(record.userId) ??
        (await guild.members
          .fetch(record.userId)
          .catch(() => null));

      if (!member) {
        delete absenceData.approved[recordKey];
        dataChanged = true;
        continue;
      }

      try {
        if (member.roles.cache.has(record.roleId)) {
          await member.roles.remove(
            record.roleId,
            `Afwezigheid verlopen na ${endDate.display}`,
          );
        }

        delete absenceData.approved[recordKey];
        dataChanged = true;

        const logEmbed = makeEmbed(
          'absence',
          'Afwezigheidsrol automatisch verwijderd',
        )
          .setColor(0x5865F2)
          .addFields(
          {
            name: 'Afwezig lid',
            value: formatUser(member.user),
          },
          {
            name: 'Goedgekeurd door',
            value: record.approvedBy
              ? `<@${record.approvedBy}>`
              : 'Onbekend',
          },
          {
            name: 'Periode',
            value: startDate
              ? `${startDate.display} t/m ${endDate.display}`
              : `Onbekende startdatum t/m ${endDate.display}`,
          },
          {
            name: 'Totale duur',
            value: startDate
              ? `${calculateAbsenceDurationDays(
                  startDate,
                  endDate,
                )} dagen`
              : 'Onbekend (ouder opgeslagen record)',
          },
          {
            name: 'Verwijderde rol',
            value: `<@&${record.roleId}>`,
          },
        );

        await sendLog(guild, 'absence', logEmbed);
      } catch (error) {
        console.error(
          `Afwezigheidsrol verwijderen mislukt voor ` +
          `${record.userId}:`,
          error.message,
        );
      }
    }

    if (dataChanged) {
      await queueAbsenceSave();
    }
  } finally {
    absenceExpiryCheckRunning = false;
  }
}

function parseProcessingAmountNumber(value) {
  const text = String(value ?? '').trim().toLowerCase();
  const thousandsMatch = text.match(
    /(\d+(?:[.,]\d+)?)\s*k\b/i,
  );

  if (thousandsMatch) {
    const thousands = Number.parseFloat(
      thousandsMatch[1].replace(',', '.'),
    );

    return Number.isFinite(thousands)
      ? Math.round(thousands * 1000)
      : null;
  }

  const numberMatch = text.match(/\d[\d\s.,]*/);
  if (!numberMatch) return null;

  const digits = numberMatch[0].replace(/\D/g, '');
  const amount = Number.parseInt(digits, 10);

  return Number.isSafeInteger(amount) ? amount : null;
}

function createEmptyProcessingReminderData() {
  return {
    version: 1,
    pending: {},
  };
}

async function writeProcessingReminderData(snapshot) {
  await mkdir(
    dirname(PROCESSING_REMINDER_DATA_FILE),
    { recursive: true },
  );

  const temporaryFile =
    `${PROCESSING_REMINDER_DATA_FILE}.${process.pid}.tmp`;
  await writeFile(temporaryFile, snapshot, 'utf8');
  await rename(temporaryFile, PROCESSING_REMINDER_DATA_FILE);
}

function queueProcessingReminderSave() {
  const snapshot = JSON.stringify(
    processingReminderData,
    null,
    2,
  );

  processingReminderWriteQueue = processingReminderWriteQueue
    .catch(() => {})
    .then(() => writeProcessingReminderData(snapshot));

  return processingReminderWriteQueue;
}

async function initializeProcessingReminderStore() {
  await mkdir(
    dirname(PROCESSING_REMINDER_DATA_FILE),
    { recursive: true },
  );

  try {
    const savedData = JSON.parse(
      await readFile(PROCESSING_REMINDER_DATA_FILE, 'utf8'),
    );

    if (
      !savedData ||
      typeof savedData !== 'object' ||
      !savedData.pending ||
      typeof savedData.pending !== 'object' ||
      Array.isArray(savedData.pending)
    ) {
      throw new Error('ongeldig gegevensformaat');
    }

    processingReminderData = {
      version: 1,
      pending: savedData.pending,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(
        `Herinneringsbestand kon niet worden gelezen: ` +
        `${error.message}`,
      );
    }

    processingReminderData =
      createEmptyProcessingReminderData();
    await writeProcessingReminderData(
      JSON.stringify(processingReminderData, null, 2),
    );
  }

  processingReminderStoreReady = true;
  console.log(
    `Verwerkherinneringen actief: ` +
    `${PROCESSING_REMINDER_DATA_FILE}`,
  );

  if (!PROCESSING_REMINDER_CHANNEL_ID) {
    console.warn(
      'WAARSCHUWING: PROCESSING_REMINDER_CHANNEL_ID ontbreekt. ' +
      'Herinneringen blijven bewaard tot een kanaal is ingesteld.',
    );
  }

  if (!PROCESSING_REMINDER_ROLE_ID) {
    console.warn(
      'WAARSCHUWING: PROCESSING_REMINDER_ROLE_ID ontbreekt. ' +
      'Herinneringen worden zonder beheerrolping verstuurd.',
    );
  }
}

function processingReminderKey(guildId, messageId) {
  return `${guildId}:${messageId}`;
}

async function scheduleProcessingReminder({
  guildId,
  requesterId,
  requesterName,
  amountText,
  amountValue,
  approvedBy,
  sourceChannelId,
  sourceMessageId,
  sourceMessageUrl,
}) {
  if (!processingReminderStoreReady) {
    throw new Error('herinneringsopslag is niet beschikbaar');
  }

  const recordKey = processingReminderKey(
    guildId,
    sourceMessageId,
  );
  const previousRecord =
    processingReminderData.pending[recordKey];
  const approvedAt = Date.now();
  const dueAt =
    approvedAt + PROCESSING_REMINDER_DELAY_MS;

  processingReminderData.pending[recordKey] = {
    guildId,
    requesterId,
    requesterName,
    amountText,
    amountValue,
    approvedBy,
    approvedAt,
    dueAt,
    sourceChannelId,
    sourceMessageId,
    sourceMessageUrl,
  };

  try {
    await queueProcessingReminderSave();
  } catch (error) {
    if (previousRecord) {
      processingReminderData.pending[recordKey] =
        previousRecord;
    } else {
      delete processingReminderData.pending[recordKey];
    }

    throw error;
  }

  return dueAt;
}

async function resolveProcessingReminderDestination(guild) {
  if (!PROCESSING_REMINDER_CHANNEL_ID) return null;

  const reminderChannel =
    guild.channels.cache.get(PROCESSING_REMINDER_CHANNEL_ID) ??
    (await guild.channels
      .fetch(PROCESSING_REMINDER_CHANNEL_ID)
      .catch(() => null));

  if (
    !reminderChannel ||
    typeof reminderChannel.send !== 'function'
  ) {
    return null;
  }

  let roleToPing = null;

  if (PROCESSING_REMINDER_ROLE_ID) {
    const managementRole =
      guild.roles.cache.get(PROCESSING_REMINDER_ROLE_ID) ??
      (await guild.roles
        .fetch(PROCESSING_REMINDER_ROLE_ID)
        .catch(() => null));
    const botMember = guild.members.me;
    const botPermissions =
      botMember &&
      typeof reminderChannel.permissionsFor === 'function'
        ? reminderChannel.permissionsFor(botMember)
        : null;

    if (
      managementRole &&
      (
        managementRole.mentionable ||
        botPermissions?.has(
          PermissionFlagsBits.MentionEveryone,
        )
      )
    ) {
      roleToPing = managementRole;
    }
  }

  return {
    reminderChannel,
    roleToPing,
  };
}

function processingReminderMention(roleToPing, fallbackText) {
  return {
    content: roleToPing
      ? `<@&${roleToPing.id}>`
      : fallbackText,
    allowedMentions: {
      parse: [],
      roles: roleToPing ? [roleToPing.id] : [],
    },
  };
}

async function sendProcessingReminderStarted({
  guild,
  requesterId,
  requesterName,
  amountText,
  approvedBy,
  dueAt,
  sourceMessageUrl,
}) {
  const destination =
    await resolveProcessingReminderDestination(guild);

  if (!destination) {
    throw new Error(
      `geen toegang tot herinneringskanaal ` +
      `${PROCESSING_REMINDER_CHANNEL_ID || 'niet ingesteld'}`,
    );
  }

  const dueTimestamp = Math.floor(dueAt / 1000);
  const startEmbed = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle('⏳ Grote verwerkaanvraag goedgekeurd')
    .setDescription(
      'Er is een aanvraag met een hoeveelheid van **1000 of ' +
      'hoger** goedgekeurd. De automatische beheerherinnering ' +
      `volgt <t:${dueTimestamp}:R>.`,
    )
    .addFields(
      {
        name: 'Persoon',
        value: `<@${requesterId}>`,
      },
      {
        name: 'Naam',
        value: shorten(requesterName || 'Onbekend'),
        inline: true,
      },
      {
        name: 'Hoeveelheid',
        value: shorten(amountText),
        inline: true,
      },
      {
        name: 'Goedgekeurd door',
        value: `<@${approvedBy}>`,
      },
      {
        name: 'Timer',
        value:
          `Eindigt <t:${dueTimestamp}:F>\n` +
          `Resterende tijd: <t:${dueTimestamp}:R>`,
      },
      {
        name: 'Oorspronkelijke aanvraag',
        value: `[Open het bericht](${sourceMessageUrl})`,
      },
    )
    .setFooter({
      text: 'Automatische eindmelding volgt na 2 uur',
    })
    .setTimestamp();

  const mention = processingReminderMention(
    destination.roleToPing,
    '⏳ Grote verwerkaanvraag goedgekeurd',
  );

  return destination.reminderChannel.send({
    ...mention,
    embeds: [startEmbed],
  });
}

async function processDueProcessingReminders(discordClient) {
  if (
    !processingReminderStoreReady ||
    processingReminderCheckRunning
  ) {
    return;
  }

  processingReminderCheckRunning = true;
  let dataChanged = false;

  try {
    for (
      const [recordKey, record] of
      Object.entries(processingReminderData.pending)
    ) {
      if (
        !record?.guildId ||
        !record?.requesterId ||
        !Number.isFinite(record?.dueAt)
      ) {
        delete processingReminderData.pending[recordKey];
        dataChanged = true;
        continue;
      }

      if (record.dueAt > Date.now()) continue;

      if (!PROCESSING_REMINDER_CHANNEL_ID) {
        console.error(
          'Grote verwerkaanvraag is klaar voor een herinnering, ' +
          'maar PROCESSING_REMINDER_CHANNEL_ID ontbreekt.',
        );
        continue;
      }

      const guild =
        discordClient.guilds.cache.get(record.guildId) ??
        (await discordClient.guilds
          .fetch(record.guildId)
          .catch(() => null));

      if (!guild) continue;

      const destination =
        await resolveProcessingReminderDestination(guild);

      if (!destination) {
        console.error(
          `Geen toegang tot herinneringskanaal ` +
          `${PROCESSING_REMINDER_CHANNEL_ID}`,
        );
        continue;
      }

      const reminderEmbed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('⏰ Herinnering grote verwerkaanvraag')
        .setDescription(
          'Deze goedgekeurde aanvraag heeft een hoeveelheid van ' +
          `${record.amountValue} of hoger en is inmiddels twee uur oud.`,
        )
        .addFields(
          {
            name: 'Persoon',
            value: `<@${record.requesterId}>`,
          },
          {
            name: 'Naam',
            value: shorten(
              record.requesterName || 'Onbekend',
            ),
            inline: true,
          },
          {
            name: 'Hoeveelheid',
            value: shorten(record.amountText),
            inline: true,
          },
          {
            name: 'Goedgekeurd door',
            value: `<@${record.approvedBy}>`,
          },
          {
            name: 'Goedgekeurd op',
            value:
              `<t:${Math.floor(record.approvedAt / 1000)}:F>`,
          },
          {
            name: 'Oorspronkelijke aanvraag',
            value: `[Open het bericht](${record.sourceMessageUrl})`,
          },
        )
        .setFooter({
          text: 'Automatische melding • 2 uur na goedkeuring',
        })
        .setTimestamp();

      try {
        const mention = processingReminderMention(
          destination.roleToPing,
          '⏰ Beheerherinnering',
        );

        await destination.reminderChannel.send({
          ...mention,
          embeds: [reminderEmbed],
        });

        delete processingReminderData.pending[recordKey];
        dataChanged = true;

        const logEmbed = makeEmbed(
          'pluk',
          'Grote verwerkaanvraag-herinnering verstuurd',
        ).addFields(
          {
            name: 'Persoon',
            value: `<@${record.requesterId}>`,
          },
          {
            name: 'Hoeveelheid',
            value: shorten(record.amountText),
          },
          {
            name: 'Herinneringskanaal',
            value:
              `<#${PROCESSING_REMINDER_CHANNEL_ID}>`,
          },
          {
            name: 'Aanvraag',
            value:
              `[Open het bericht](${record.sourceMessageUrl})`,
          },
        );

        await sendLog(guild, 'pluk', logEmbed);
      } catch (error) {
        console.error(
          'Verwerkherinnering versturen mislukt:',
          error.message,
        );
      }
    }

    if (dataChanged) {
      await queueProcessingReminderSave();
    }
  } finally {
    processingReminderCheckRunning = false;
  }
}

function createEmptyGiveawayData() {
  return {
    version: 1,
    active: {},
  };
}

async function writeGiveawayData(snapshot) {
  await mkdir(
    dirname(GIVEAWAY_DATA_FILE),
    { recursive: true },
  );

  const temporaryFile =
    `${GIVEAWAY_DATA_FILE}.${process.pid}.tmp`;
  await writeFile(temporaryFile, snapshot, 'utf8');
  await rename(temporaryFile, GIVEAWAY_DATA_FILE);
}

function queueGiveawaySave() {
  const snapshot = JSON.stringify(giveawayData, null, 2);

  giveawayWriteQueue = giveawayWriteQueue
    .catch(() => {})
    .then(() => writeGiveawayData(snapshot));

  return giveawayWriteQueue;
}

async function initializeGiveawayStore() {
  await mkdir(
    dirname(GIVEAWAY_DATA_FILE),
    { recursive: true },
  );

  try {
    const savedData = JSON.parse(
      await readFile(GIVEAWAY_DATA_FILE, 'utf8'),
    );

    if (
      !savedData ||
      typeof savedData !== 'object' ||
      !savedData.active ||
      typeof savedData.active !== 'object' ||
      Array.isArray(savedData.active)
    ) {
      throw new Error('ongeldig gegevensformaat');
    }

    giveawayData = {
      version: 1,
      active: savedData.active,
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(
        `Giveawaybestand kon niet worden gelezen: ` +
        `${error.message}`,
      );
    }

    giveawayData = createEmptyGiveawayData();
    await writeGiveawayData(
      JSON.stringify(giveawayData, null, 2),
    );
  }

  giveawayStoreReady = true;
  console.log(`Giveawayopslag actief: ${GIVEAWAY_DATA_FILE}`);

  if (!LOG_CHANNELS.giveaway) {
    console.warn(
      'WAARSCHUWING: GIVEAWAY_LOG_CHANNEL_ID en ' +
      'SERVER_LOG_CHANNEL_ID ontbreken. Giveawaylogs worden ' +
      'niet verstuurd.',
    );
  }
}

function cleanupGiveawayDrafts() {
  const now = Date.now();

  for (const [draftId, draft] of giveawayDrafts) {
    if (draft.expiresAt <= now) {
      giveawayDrafts.delete(draftId);
    }
  }
}

function getAmsterdamDateTimeParts(timestamp) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: GIVEAWAY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const values = {};

  for (const part of formatter.formatToParts(timestamp)) {
    if (part.type !== 'literal') {
      values[part.type] = Number.parseInt(part.value, 10);
    }
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function getAmsterdamOffsetMilliseconds(timestamp) {
  const roundedTimestamp =
    Math.floor(timestamp / 1000) * 1000;
  const parts =
    getAmsterdamDateTimeParts(roundedTimestamp);

  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) - roundedTimestamp
  );
}

function parseGiveawayEndDateTime(dateValue, timeValue) {
  const dateMatch = String(dateValue ?? '')
    .trim()
    .match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  const timeMatch = String(timeValue ?? '')
    .trim()
    .match(/^([01]?\d|2[0-3])[:.](\d{2})$/);

  if (!dateMatch || !timeMatch) return null;

  const day = Number.parseInt(dateMatch[1], 10);
  const month = Number.parseInt(dateMatch[2], 10);
  const year = Number.parseInt(dateMatch[3], 10);
  const hour = Number.parseInt(timeMatch[1], 10);
  const minute = Number.parseInt(timeMatch[2], 10);
  const calendarCheck = new Date(
    Date.UTC(year, month - 1, day),
  );

  if (
    calendarCheck.getUTCFullYear() !== year ||
    calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day
  ) {
    return null;
  }

  const desiredUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
  );
  let timestamp = desiredUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    timestamp =
      desiredUtc -
      getAmsterdamOffsetMilliseconds(timestamp);
  }

  const resolved =
    getAmsterdamDateTimeParts(timestamp);

  if (
    resolved.year !== year ||
    resolved.month !== month ||
    resolved.day !== day ||
    resolved.hour !== hour ||
    resolved.minute !== minute
  ) {
    return null;
  }

  return timestamp;
}

function parseEventDateTime(value) {
  const match = String(value ?? '')
    .trim()
    .match(
      /^(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\s+(?:om\s+)?([01]?\d|2[0-3])[:.](\d{2})$/i,
    );

  if (!match) return null;

  return parseGiveawayEndDateTime(
    match[1],
    `${match[2]}:${match[3]}`,
  );
}

function makeGiveawayImageName(
  giveawayId,
  attachment,
  index,
) {
  const sourceName = String(attachment.name ?? '');
  const extensionMatch =
    sourceName.match(/\.([a-zA-Z0-9]{1,8})$/);
  const extension = extensionMatch?.[1]?.toLowerCase() || 'png';

  return (
    `giveaway-${giveawayId.slice(0, 8)}-` +
    `${index + 1}.${extension}`
  );
}

function isGiveawayImageAttachment(attachment) {
  const contentType = String(
    attachment.contentType ?? '',
  ).toLowerCase();

  if (contentType) {
    return contentType.startsWith('image/');
  }

  return /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i.test(
    String(attachment.name ?? ''),
  );
}

function buildGiveawayEmbeds(record, ended = false) {
  const endTimestamp = Math.floor(record.endAt / 1000);
  const participantCount =
    record.participantIds?.length ?? 0;
  const winnerIds = record.winnerIds ?? [];
  const winnerText = winnerIds.length
    ? winnerIds.map(userId => `<@${userId}>`).join('\n')
    : '*Geen winnaar: er waren geen geldige deelnemers.*';
  const mainEmbed = new EmbedBuilder()
    .setColor(ended ? 0xED4245 : 0xD4AF37)
    .setTitle(
      ended
        ? '🎊 𝑳𝑪𝑵 𝑮𝒊𝒗𝒆𝒂𝒘𝒂𝒚 — Afgelopen'
        : '🎁 𝑳𝒂 𝑪𝒐𝒔𝒂 𝑵𝒐𝒔𝒕𝒓𝒂 𝑮𝒊𝒗𝒆𝒂𝒘𝒂𝒚',
    )
    .setDescription(
      ended
        ? `De giveaway voor **${shorten(record.prize, 500)}** ` +
          'is afgelopen. Bedankt voor het meedoen!'
        : `## ✨ ${shorten(record.prize, 200)}\n\n` +
          '**Wat moet je doen om te winnen?**\n' +
          `> ${shorten(record.requirements, 1800)
            .replaceAll('\n', '\n> ')}`,
    )
    .addFields(
      {
        name: '🏆 Giveaway',
        value: shorten(record.prize),
      },
      {
        name: ended ? '👑 Winnaar(s)' : '👑 Aantal winnaars',
        value: ended
          ? winnerText
          : String(record.winnerCount),
        inline: !ended,
      },
      {
        name: '🎟️ Deelnemers',
        value: String(participantCount),
        inline: true,
      },
      {
        name: ended ? '🕰️ Afgelopen op' : '⏳ Eindigt',
        value: ended
          ? `<t:${Math.floor(record.endedAt / 1000)}:F>`
          : `<t:${endTimestamp}:F>\n` +
            `**Resterende tijd:** <t:${endTimestamp}:R>`,
      },
      {
        name: '📣 Aangekondigd voor',
        value: `<@&${record.roleId}>`,
      },
    )
    .setFooter({
      text:
        `Giveaway ${record.id.slice(0, 8)} • ` +
        `Gestart door ${record.createdByTag}`,
    })
    .setTimestamp(
      ended ? record.endedAt : record.createdAt,
    );

  if (record.guildIconUrl) {
    mainEmbed.setThumbnail(record.guildIconUrl);
  }

  if (record.imageNames?.[0]) {
    mainEmbed.setImage(
      `attachment://${record.imageNames[0]}`,
    );
  }

  const imageEmbeds = (record.imageNames ?? [])
    .slice(1, 3)
    .map(imageName =>
      new EmbedBuilder()
        .setColor(ended ? 0xED4245 : 0xD4AF37)
        .setImage(`attachment://${imageName}`),
    );

  return [mainEmbed, ...imageEmbeds];
}

function buildGiveawayJoinRow(record) {
  const participantCount =
    record.participantIds?.length ?? 0;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:join:${record.id}`)
      .setLabel(`Meedoen • ${participantCount}`)
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success),
  );
}

function selectRandomGiveawayWinners(
  participantIds,
  winnerCount,
) {
  const shuffled = [...new Set(participantIds)];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const otherIndex = randomInt(index + 1);
    [shuffled[index], shuffled[otherIndex]] =
      [shuffled[otherIndex], shuffled[index]];
  }

  return shuffled.slice(
    0,
    Math.min(winnerCount, shuffled.length),
  );
}

async function resolveGiveawayChannel(guild, channelId) {
  return (
    guild.channels.cache.get(channelId) ??
    (await guild.channels.fetch(channelId).catch(() => null))
  );
}

async function finishGiveaway({
  guild,
  giveawayId,
  manualWinnerIds = null,
  endedBy = null,
}) {
  if (giveawayLocks.has(giveawayId)) {
    throw new Error('Deze giveaway wordt al verwerkt.');
  }

  const record = giveawayData.active[giveawayId];
  if (!record) {
    throw new Error('Deze giveaway is niet meer actief.');
  }

  giveawayLocks.add(giveawayId);

  try {
    if (record.status !== 'ending') {
      const participants = [
        ...new Set(record.participantIds ?? []),
      ];
      const winners = manualWinnerIds
        ? [...new Set(manualWinnerIds)]
        : selectRandomGiveawayWinners(
            participants,
            record.winnerCount,
          );

      record.status = 'ending';
      record.winnerIds = winners;
      record.endMode = manualWinnerIds
        ? 'handmatig'
        : 'automatisch';
      record.endedBy = endedBy;
      record.endedAt = Date.now();
      await queueGiveawaySave();
    }

    const channel =
      await resolveGiveawayChannel(guild, record.channelId);

    if (
      !channel ||
      typeof channel.send !== 'function' ||
      typeof channel.messages?.fetch !== 'function'
    ) {
      throw new Error(
        `geen toegang tot giveawaykanaal ${record.channelId}`,
      );
    }

    const giveawayMessage =
      await channel.messages
        .fetch(record.messageId)
        .catch(() => null);

    if (giveawayMessage) {
      await giveawayMessage.edit({
        embeds: buildGiveawayEmbeds(record, true),
        components: [],
        allowedMentions: { parse: [] },
      });
    }

    if (!record.resultMessageId) {
      const winnerMentions = (record.winnerIds ?? [])
        .map(userId => `<@${userId}>`)
        .join(' ');
      const resultEmbed = new EmbedBuilder()
        .setColor(0xD4AF37)
        .setTitle('🎉 De winnaar(s) zijn bekend!')
        .setDescription(
          record.winnerIds?.length
            ? `Gefeliciteerd ${winnerMentions}!\n\n` +
              `Jullie winnen **${shorten(record.prize, 1000)}**.`
            : 'Er waren geen deelnemers, dus er is geen winnaar.',
        )
        .addFields(
          {
            name: 'Selectie',
            value:
              record.endMode === 'handmatig'
                ? 'Handmatig gekozen door beheer'
                : 'Automatisch en willekeurig gekozen',
          },
          {
            name: 'Deelnemers',
            value: String(
              record.participantIds?.length ?? 0,
            ),
            inline: true,
          },
          {
            name: 'Winnaars',
            value: String(record.winnerIds?.length ?? 0),
            inline: true,
          },
        )
        .setFooter({
          text: 'Hollow Kings • Giveawayresultaat',
        })
        .setTimestamp(record.endedAt);
      const resultMessage = await channel.send({
        content: winnerMentions || '🎊 Giveaway afgelopen',
        embeds: [resultEmbed],
        allowedMentions: {
          parse: [],
          users: record.winnerIds ?? [],
        },
      });

      record.resultMessageId = resultMessage.id;
      await queueGiveawaySave();
    }

    const logEmbed = makeEmbed(
      'giveaway',
      record.endMode === 'handmatig'
        ? 'Giveaway handmatig beëindigd'
        : 'Giveaway automatisch beëindigd',
    ).addFields(
      {
        name: 'Giveaway',
        value: shorten(record.prize),
      },
      {
        name: 'Winnaar(s)',
        value: record.winnerIds?.length
          ? record.winnerIds
              .map(userId => `<@${userId}>`)
              .join('\n')
          : 'Geen',
      },
      {
        name: 'Deelnemers',
        value: String(record.participantIds?.length ?? 0),
      },
      {
        name: 'Beëindigd door',
        value: record.endedBy
          ? `<@${record.endedBy}>`
          : 'Automatische timer',
      },
      {
        name: 'Originele giveaway',
        value:
          `https://discord.com/channels/${record.guildId}/` +
          `${record.channelId}/${record.messageId}`,
      },
    );

    await sendLog(guild, 'giveaway', logEmbed);

    const finishedRecord = giveawayData.active[giveawayId];
    delete giveawayData.active[giveawayId];

    try {
      await queueGiveawaySave();
    } catch (error) {
      giveawayData.active[giveawayId] = finishedRecord;
      throw error;
    }

    return record;
  } finally {
    giveawayLocks.delete(giveawayId);
  }
}

async function processDueGiveaways(discordClient) {
  if (!giveawayStoreReady || giveawayCheckRunning) {
    return;
  }

  giveawayCheckRunning = true;

  try {
    for (
      const [giveawayId, record] of
      Object.entries(giveawayData.active)
    ) {
      if (
        !record?.guildId ||
        !record?.channelId ||
        !record?.messageId ||
        !Number.isFinite(record?.endAt)
      ) {
        delete giveawayData.active[giveawayId];
        await queueGiveawaySave();
        continue;
      }

      if (
        record.status !== 'ending' &&
        record.endAt > Date.now()
      ) {
        continue;
      }

      const guild =
        discordClient.guilds.cache.get(record.guildId) ??
        (await discordClient.guilds
          .fetch(record.guildId)
          .catch(() => null));

      if (!guild) continue;

      await finishGiveaway({
        guild,
        giveawayId,
      }).catch(error => {
        console.error(
          `Giveaway ${giveawayId} beëindigen mislukt:`,
          error.message,
        );
      });
    }
  } finally {
    giveawayCheckRunning = false;
  }
}

function createEmptyCommunityData() {
  return {
    version: 2,
    dashboards: {},
    events: {},
    cooldowns: {},
  };
}

async function writeCommunityData(snapshot) {
  await mkdir(
    dirname(COMMUNITY_DATA_FILE),
    { recursive: true },
  );

  const temporaryFile =
    `${COMMUNITY_DATA_FILE}.${process.pid}.tmp`;
  await writeFile(temporaryFile, snapshot, 'utf8');
  await rename(temporaryFile, COMMUNITY_DATA_FILE);
}

function queueCommunitySave() {
  const snapshot = JSON.stringify(
    communityData,
    null,
    2,
  );

  communityWriteQueue = communityWriteQueue
    .catch(() => {})
    .then(() => writeCommunityData(snapshot));

  return communityWriteQueue;
}

async function initializeCommunityStore() {
  await mkdir(
    dirname(COMMUNITY_DATA_FILE),
    { recursive: true },
  );

  try {
    const savedData = JSON.parse(
      await readFile(COMMUNITY_DATA_FILE, 'utf8'),
    );

    if (
      !savedData ||
      typeof savedData !== 'object' ||
      !savedData.dashboards ||
      typeof savedData.dashboards !== 'object' ||
      Array.isArray(savedData.dashboards) ||
      !savedData.events ||
      typeof savedData.events !== 'object' ||
      Array.isArray(savedData.events)
    ) {
      throw new Error('ongeldig gegevensformaat');
    }

    communityData = {
      version: 2,
      dashboards: savedData.dashboards,
      events: savedData.events,
      cooldowns:
        savedData.cooldowns &&
        typeof savedData.cooldowns === 'object' &&
        !Array.isArray(savedData.cooldowns)
          ? savedData.cooldowns
          : {},
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(
        `Communitybestand kon niet worden gelezen: ` +
        `${error.message}`,
      );
    }

    communityData = createEmptyCommunityData();
    await writeCommunityData(
      JSON.stringify(communityData, null, 2),
    );
  }

  communityStoreReady = true;
  console.log(
    `Dashboard-/evenementen-/cooldownopslag actief: ` +
    `${COMMUNITY_DATA_FILE}`,
  );

  if (
    process.env.RAILWAY_ENVIRONMENT_ID &&
    !process.env.RAILWAY_VOLUME_MOUNT_PATH
  ) {
    console.warn(
      'WAARSCHUWING: geen Railway-volume gekoppeld. ' +
      'Dashboards, evenementen, cooldowns en aanmeldingen kunnen ' +
      'bij een deployment verdwijnen.',
    );
  }
}

async function resolveCommunityChannel(guild, channelId) {
  return (
    guild.channels.cache.get(channelId) ??
    (await guild.channels.fetch(channelId).catch(() => null))
  );
}

function hasCommunityChannelPermissions(guild, channel) {
  const botMember = guild.members.me;
  const permissions =
    botMember &&
    typeof channel?.permissionsFor === 'function'
      ? channel.permissionsFor(botMember)
      : null;

  return (
    permissions?.has(PermissionFlagsBits.ViewChannel) === true &&
    permissions.has(PermissionFlagsBits.SendMessages) &&
    permissions.has(PermissionFlagsBits.EmbedLinks)
  );
}

async function getDashboardMembers(guild) {
  if (
    guild.members.cache.size >= guild.memberCount &&
    guild.members.cache.size
  ) {
    return guild.members.cache;
  }

  return guild.members.fetch();
}

function getActiveCommunityEvents(guildId) {
  return Object.values(communityData.events)
    .filter(
      record =>
        record?.guildId === guildId &&
        record.status === 'active' &&
        Number.isFinite(record.startAt) &&
        record.startAt > Date.now(),
    )
    .sort(
      (recordA, recordB) =>
        recordA.startAt - recordB.startAt,
    );
}

async function buildDashboardEmbed(guild, updatedAt = Date.now()) {
  const members = await getDashboardMembers(guild);
  const gangMembers = [...members.values()]
    .filter(
      member =>
        !member.user?.bot &&
        memberHasGangRole(member),
    );
  const pointsTotals = pointsStoreReady
    ? calculatePointsTotals(guild.id)
    : new Map();
  const rankedMembers = gangMembers
    .map(member => ({
      member,
      points: pointsTotals.get(member.id) ?? 0,
    }))
    .sort(
      (entryA, entryB) =>
        entryB.points - entryA.points ||
        entryA.member.displayName.localeCompare(
          entryB.member.displayName,
          'nl',
          { sensitivity: 'base' },
        ),
    );
  const totalPoints = rankedMembers.reduce(
    (sum, entry) => sum + entry.points,
    0,
  );
  const topMembers = rankedMembers
    .slice(0, 3)
    .map(
      (entry, index) =>
        `${['🥇', '🥈', '🥉'][index]} ` +
        `<@${entry.member.id}> — **${entry.points}**`,
    )
    .join('\n');
  const absenceCount = absenceStoreReady
    ? Object.values(absenceData.approved)
        .filter(record => record?.guildId === guild.id)
        .length
    : 0;
  const processingCount = processingReminderStoreReady
    ? Object.values(processingReminderData.pending)
        .filter(record => record?.guildId === guild.id)
        .length
    : 0;
  const giveawayCount = giveawayStoreReady
    ? Object.values(giveawayData.active)
        .filter(
          record =>
            record?.guildId === guild.id &&
            record.status === 'active',
        )
        .length
    : 0;
  const activeEvents =
    getActiveCommunityEvents(guild.id);
  const nextEvent = activeEvents[0];
  const updatedTimestamp = Math.floor(updatedAt / 1000);
  const embed = new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle('👑 Hollow Kings • Live Dashboard')
    .setDescription(
      'Een actueel overzicht van de gang. Dit bericht wordt ' +
      'automatisch iedere vijf minuten bijgewerkt.',
    )
    .addFields(
      {
        name: '👥 Gangleden',
        value:
          `**${gangMembers.length} / ${GANG_MEMBER_LIMIT}** leden`,
        inline: true,
      },
      {
        name: '⭐ Totale punten',
        value: `**${totalPoints}** punten`,
        inline: true,
      },
      {
        name: '🏖️ Afwezig',
        value: `**${absenceCount}** goedgekeurd`,
        inline: true,
      },
      {
        name: '🎁 Giveaways',
        value: `**${giveawayCount}** actief`,
        inline: true,
      },
      {
        name: '📅 Evenementen',
        value: `**${activeEvents.length}** gepland`,
        inline: true,
      },
      {
        name: '📦 Grote aanvragen',
        value: `**${processingCount}** herinnering(en)`,
        inline: true,
      },
      {
        name: '🏆 Punten-top 3',
        value: topMembers || '*Nog geen punten geregistreerd.*',
      },
      {
        name: '⏭️ Volgende evenement',
        value: nextEvent
          ? [
              `**${shorten(nextEvent.title, 200)}**`,
              `<t:${Math.floor(nextEvent.startAt / 1000)}:F>`,
              `<t:${Math.floor(nextEvent.startAt / 1000)}:R>`,
              nextEvent.messageId
                ? `[Open evenement](https://discord.com/channels/` +
                  `${nextEvent.guildId}/${nextEvent.channelId}/` +
                  `${nextEvent.messageId})`
                : null,
            ].filter(Boolean).join('\n')
          : '*Er staat nog geen evenement gepland.*',
      },
    )
    .setFooter({
      text:
        `Automatisch bijgewerkt • ` +
        `${gangMembers.length} actieve gangleden`,
    })
    .setTimestamp(updatedAt);

  if (guild.iconURL?.({ size: 256 })) {
    embed.setThumbnail(guild.iconURL({ size: 256 }));
  }

  embed.addFields({
    name: '🔄 Laatste update',
    value:
      `<t:${updatedTimestamp}:F> ` +
      `(<t:${updatedTimestamp}:R>)`,
  });

  return embed;
}

function buildDashboardRow(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dashboard:refresh:${guildId}`)
      .setLabel('Nu vernieuwen')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
  );
}

async function removeDashboardRecord(guildId) {
  if (!communityData.dashboards[guildId]) return;
  delete communityData.dashboards[guildId];
  await queueCommunitySave();
}

async function updateDashboardMessage(
  guild,
  { force = false } = {},
) {
  if (!communityStoreReady) {
    return { status: 'store-unavailable' };
  }

  const record = communityData.dashboards[guild.id];
  if (!record) return { status: 'not-configured' };

  if (
    !force &&
    Number.isFinite(record.updatedAt) &&
    Date.now() - record.updatedAt <
      DASHBOARD_REFRESH_INTERVAL_MS
  ) {
    return { status: 'not-due' };
  }

  if (dashboardRefreshInProgress.has(guild.id)) {
    return { status: 'busy' };
  }

  dashboardRefreshInProgress.add(guild.id);

  try {
    const channel = await resolveCommunityChannel(
      guild,
      record.channelId,
    );

    if (
      !channel ||
      typeof channel.messages?.fetch !== 'function'
    ) {
      await removeDashboardRecord(guild.id);
      return { status: 'channel-unavailable' };
    }

    const message = await channel.messages
      .fetch(record.messageId)
      .catch(() => null);

    if (!message) {
      await removeDashboardRecord(guild.id);
      return { status: 'message-unavailable' };
    }

    const updatedAt = Date.now();
    const embed = await buildDashboardEmbed(
      guild,
      updatedAt,
    );

    await message.edit({
      embeds: [embed],
      components: [buildDashboardRow(guild.id)],
      allowedMentions: { parse: [] },
    });

    record.updatedAt = updatedAt;
    await queueCommunitySave();

    return {
      status: 'updated',
      message,
    };
  } finally {
    dashboardRefreshInProgress.delete(guild.id);
  }
}

function cleanupEventDrafts() {
  const now = Date.now();

  for (const [draftId, draft] of eventDrafts) {
    if (draft.expiresAt <= now) {
      eventDrafts.delete(draftId);
    }
  }
}

function normalizeEventResponses(record) {
  record.responses ??= {};
  record.responses.attending ??= [];
  record.responses.maybe ??= [];
  record.responses.declined ??= [];
  return record.responses;
}

function getEventResponseLabel(responseType) {
  return {
    attending: 'Aanwezig',
    maybe: 'Misschien',
    declined: 'Afwezig',
  }[responseType] ?? 'Onbekend';
}

function buildEventEmbed(record) {
  const responses = normalizeEventResponses(record);
  const status = record.status ?? 'active';
  const isCancelled = status === 'cancelled';
  const isStarted = status === 'started';
  const startTimestamp =
    Math.floor(record.startAt / 1000);
  const attendingText = responses.attending.length
    ? responses.attending
        .map(userId => `<@${userId}>`)
        .join(', ')
    : '*Nog niemand*';
  const maybeText = responses.maybe.length
    ? responses.maybe
        .map(userId => `<@${userId}>`)
        .join(', ')
    : '*Nog niemand*';
  const embed = new EmbedBuilder()
    .setColor(
      isCancelled
        ? 0xED4245
        : isStarted
          ? 0x57F287
          : 0xD4AF37,
    )
    .setTitle(
      isCancelled
        ? `❌ ${shorten(record.title, 220)}`
        : isStarted
          ? `🚀 ${shorten(record.title, 220)}`
          : `📅 ${shorten(record.title, 220)}`,
    )
    .setDescription(
      isCancelled
        ? '## Evenement geannuleerd\n' +
          shorten(
            record.description ||
              'Dit evenement gaat niet meer door.',
            3000,
          )
        : isStarted
          ? '## Het evenement is begonnen!\n' +
            shorten(record.description, 3000)
          : shorten(record.description, 3500),
    )
    .addFields(
      {
        name: '🗓️ Datum en tijd',
        value:
          `<t:${startTimestamp}:F>\n` +
          `<t:${startTimestamp}:R>`,
      },
      {
        name: '📍 Locatie',
        value: shorten(record.location || 'Niet opgegeven'),
        inline: true,
      },
      {
        name: '👤 Georganiseerd door',
        value: `<@${record.createdBy}>`,
        inline: true,
      },
      {
        name: '✅ Aanwezig',
        value:
          `**${responses.attending.length}**\n` +
          shorten(attendingText, 900),
      },
      {
        name: '❔ Misschien',
        value:
          `**${responses.maybe.length}**\n` +
          shorten(maybeText, 900),
      },
      {
        name: '❌ Afwezig',
        value: `**${responses.declined.length}**`,
        inline: true,
      },
      {
        name: '📣 Aangekondigd voor',
        value: `<@&${record.roleId}>`,
        inline: true,
      },
    )
    .setFooter({
      text:
        `Evenement-ID: ${record.id.slice(0, 8)} • ` +
        'Hollow Kings',
    })
    .setTimestamp(record.createdAt);

  if (record.guildIconUrl) {
    embed.setThumbnail(record.guildIconUrl);
  }

  if (isCancelled) {
    embed.addFields({
      name: 'Geannuleerd door',
      value: record.cancelledBy
        ? `<@${record.cancelledBy}>`
        : 'Onbekend',
    });
  }

  return embed;
}

function buildEventResponseRow(record, disabled = false) {
  const responses = normalizeEventResponses(record);

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`event:attending:${record.id}`)
      .setLabel(`Aanwezig • ${responses.attending.length}`)
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`event:maybe:${record.id}`)
      .setLabel(`Misschien • ${responses.maybe.length}`)
      .setEmoji('❔')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`event:declined:${record.id}`)
      .setLabel(`Afwezig • ${responses.declined.length}`)
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

function getEventParticipantUserIds(record) {
  const responses = normalizeEventResponses(record);
  return [
    ...new Set([
      ...responses.attending,
      ...responses.maybe,
    ]),
  ];
}

async function canPingCommunityRole(
  guild,
  channel,
  roleId,
) {
  const role =
    guild.roles.cache.get(roleId) ??
    (await guild.roles.fetch(roleId).catch(() => null));

  if (!role) {
    return {
      role: null,
      canPing: false,
    };
  }

  if (role.mentionable) {
    return {
      role,
      canPing: true,
    };
  }

  const botMember = guild.members.me;
  const permissions =
    botMember &&
    typeof channel.permissionsFor === 'function'
      ? channel.permissionsFor(botMember)
      : null;

  return {
    role,
    canPing:
      permissions?.has(
        PermissionFlagsBits.MentionEveryone,
      ) === true,
  };
}

async function updateEventMessage(guild, record) {
  const channel = await resolveCommunityChannel(
    guild,
    record.channelId,
  );

  if (
    !channel ||
    typeof channel.messages?.fetch !== 'function'
  ) {
    return null;
  }

  const message = await channel.messages
    .fetch(record.messageId)
    .catch(() => null);

  if (!message) return null;

  await message.edit({
    embeds: [buildEventEmbed(record)],
    components: [
      buildEventResponseRow(
        record,
        record.status !== 'active',
      ),
    ],
    allowedMentions: { parse: [] },
  });

  return message;
}

async function startCommunityEvent(guild, record) {
  if (record.status !== 'active') return;

  record.status = 'started';
  record.startedAt = Date.now();
  await queueCommunitySave();

  await updateEventMessage(guild, record).catch(error => {
    console.error(
      `Evenementbericht ${record.id} bijwerken mislukt:`,
      error.message,
    );
  });

  const logEmbed = makeEmbed(
    'events',
    'Evenement automatisch gestart',
  ).addFields(
    {
      name: 'Evenement',
      value: shorten(record.title),
    },
    {
      name: 'Aanwezig',
      value: String(
        normalizeEventResponses(record).attending.length,
      ),
    },
    {
      name: 'Misschien',
      value: String(
        normalizeEventResponses(record).maybe.length,
      ),
    },
  );

  await sendLog(guild, 'events', logEmbed);
  updateDashboardMessage(guild, { force: true }).catch(() => {});
}

async function processCommunityEvents(discordClient) {
  for (const record of Object.values(communityData.events)) {
    if (
      !record?.guildId ||
      !record?.channelId ||
      !record?.messageId ||
      !Number.isFinite(record.startAt) ||
      record.status !== 'active'
    ) {
      continue;
    }

    const guild =
      discordClient.guilds.cache.get(record.guildId) ??
      (await discordClient.guilds
        .fetch(record.guildId)
        .catch(() => null));

    if (!guild) continue;

    const remaining = record.startAt - Date.now();

    if (remaining <= 0) {
      await startCommunityEvent(guild, record).catch(error => {
        console.error(
          `Evenement ${record.id} starten mislukt:`,
          error.message,
        );
      });
      continue;
    }

  }
}

function buildActiveCooldownEmbed(record) {
  const endTimestamp = Math.floor(record.endAt / 1000);

  return new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle('⏳ Overvalcooldown actief')
    .setDescription(
      'Er is zojuist een overval gemeld. Tijdens deze cooldown ' +
      'worden er geen nieuwe overvallen gestart.\n\n' +
      `## ⏱️ Weer beschikbaar <t:${endTimestamp}:R>`,
    )
    .addFields(
      {
        name: 'Totale cooldown',
        value: '**45 minuten**',
        inline: true,
      },
      {
        name: 'Exact eindtijdstip',
        value: `<t:${endTimestamp}:F>`,
        inline: true,
      },
      {
        name: 'Gestart door',
        value: `<@${record.startedBy}>`,
        inline: true,
      },
    )
    .setFooter({
      text:
        'De zichtbare afteller werkt automatisch bij • ' +
        'Hollow Kings',
    })
    .setTimestamp(record.startedAt);
}

function buildFinishedCooldownEmbed(record) {
  const endTimestamp = Math.floor(record.endAt / 1000);

  return new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('🟢 Overvallen weer beschikbaar')
    .setDescription(
      'De overvalcooldown van **45 minuten** is afgelopen.\n\n' +
      '## Er kunnen weer overvallen worden gedaan!',
    )
    .addFields(
      {
        name: 'Cooldown afgelopen',
        value: `<t:${endTimestamp}:F>`,
        inline: true,
      },
      {
        name: 'Gestart door',
        value: `<@${record.startedBy}>`,
        inline: true,
      },
    )
    .setFooter({
      text: 'Hollow Kings • Overvalcooldown',
    })
    .setTimestamp();
}

function buildCancelledCooldownEmbed(
  record,
  cancelledBy,
  cancelledAt,
) {
  return new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('❌ Overvalcooldown geannuleerd')
    .setDescription(
      'De actieve overvalcooldown is door beheer handmatig ' +
      'stopgezet.\n\n' +
      '**De automatische eindmelding en rolping worden niet meer ' +
      'verstuurd.**',
    )
    .addFields(
      {
        name: 'Timer gestart door',
        value: `<@${record.startedBy}>`,
        inline: true,
      },
      {
        name: 'Geannuleerd door',
        value: `<@${cancelledBy}>`,
        inline: true,
      },
      {
        name: 'Geannuleerd op',
        value: `<t:${Math.floor(cancelledAt / 1000)}:F>`,
      },
    )
    .setFooter({
      text: 'Hollow Kings • Overvalcooldown',
    })
    .setTimestamp(cancelledAt);
}

async function finishCommunityCooldown(guild, record) {
  if (cooldownLocks.has(guild.id)) return false;
  cooldownLocks.add(guild.id);

  try {
    const channel = await resolveCommunityChannel(
      guild,
      record.channelId,
    );

    if (!channel || typeof channel.send !== 'function') {
      throw new Error(
        `geen toegang tot cooldownkanaal ${record.channelId}`,
      );
    }

    const rolePing = await canPingCommunityRole(
      guild,
      channel,
      COOLDOWN_END_ROLE_ID,
    );

    if (!rolePing.role) {
      throw new Error(
        `cooldown-eindrol ${COOLDOWN_END_ROLE_ID} bestaat niet`,
      );
    }

    if (!rolePing.canPing) {
      throw new Error(
        `cooldown-eindrol ${COOLDOWN_END_ROLE_ID} kan niet echt ` +
        'worden gepingd',
      );
    }

    await channel.send({
      content:
        `<@&${COOLDOWN_END_ROLE_ID}> — ` +
        '**er kunnen weer overvallen worden gedaan!**',
      embeds: [buildFinishedCooldownEmbed(record)],
      allowedMentions: {
        parse: [],
        roles: [COOLDOWN_END_ROLE_ID],
      },
    });

    if (
      record.messageId &&
      typeof channel.messages?.fetch === 'function'
    ) {
      const startMessage = await channel.messages
        .fetch(record.messageId)
        .catch(() => null);

      if (startMessage) {
        await startMessage.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57F287)
              .setTitle('✅ Overvalcooldown afgerond')
              .setDescription(
                'Deze cooldown is afgelopen. De nieuwe melding ' +
                'hieronder geeft aan dat er weer overvallen mogen ' +
                'worden gedaan.',
              )
              .setFooter({
                text: 'Hollow Kings • Overvalcooldown',
              })
              .setTimestamp(record.endAt),
          ],
          allowedMentions: { parse: [] },
        }).catch(() => {});
      }
    }

    const scheduledTimer = cooldownTimers.get(guild.id);
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      cooldownTimers.delete(guild.id);
    }

    delete communityData.cooldowns[guild.id];
    await queueCommunitySave();
    return true;
  } finally {
    cooldownLocks.delete(guild.id);
  }
}

function scheduleCommunityCooldown(
  discordClient,
  record,
  retryDelayMs = null,
) {
  const existingTimer =
    cooldownTimers.get(record.guildId);

  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const delay = retryDelayMs ??
    Math.max(0, record.endAt - Date.now());
  const timer = setTimeout(async () => {
    cooldownTimers.delete(record.guildId);

    const currentRecord =
      communityData.cooldowns[record.guildId];

    if (
      !currentRecord ||
      currentRecord.status !== 'active' ||
      currentRecord.startedAt !== record.startedAt ||
      currentRecord.endAt !== record.endAt
    ) {
      return;
    }

    const guild =
      discordClient.guilds.cache.get(record.guildId) ??
      (await discordClient.guilds
        .fetch(record.guildId)
        .catch(() => null));

    if (!guild) {
      scheduleCommunityCooldown(
        discordClient,
        currentRecord,
        COMMUNITY_CHECK_INTERVAL_MS,
      );
      return;
    }

    try {
      const finished = await finishCommunityCooldown(
        guild,
        currentRecord,
      );

      if (!finished) {
        scheduleCommunityCooldown(
          discordClient,
          currentRecord,
          1000,
        );
      }
    } catch (error) {
      console.error(
        `Exacte cooldownmelding ${record.guildId} mislukt:`,
        error.message,
      );
      scheduleCommunityCooldown(
        discordClient,
        currentRecord,
        COMMUNITY_CHECK_INTERVAL_MS,
      );
    }
  }, Math.min(delay, 2_147_000_000));

  timer.unref?.();
  cooldownTimers.set(record.guildId, timer);
}

async function processCommunityCooldowns(discordClient) {
  let removedInvalidRecord = false;

  for (
    const [guildId, record] of
    Object.entries(communityData.cooldowns)
  ) {
    if (
      !record ||
      record.guildId !== guildId ||
      !record.channelId ||
      !record.roleId ||
      record.status !== 'active' ||
      !Number.isFinite(record.endAt)
    ) {
      const scheduledTimer = cooldownTimers.get(guildId);
      if (scheduledTimer) {
        clearTimeout(scheduledTimer);
        cooldownTimers.delete(guildId);
      }

      delete communityData.cooldowns[guildId];
      removedInvalidRecord = true;
      continue;
    }

    if (record.endAt > Date.now()) continue;

    const guild =
      discordClient.guilds.cache.get(guildId) ??
      (await discordClient.guilds
        .fetch(guildId)
        .catch(() => null));

    if (!guild) continue;

    await finishCommunityCooldown(guild, record).catch(error => {
      console.error(
        `Cooldownmelding ${guildId} mislukt:`,
        error.message,
      );
    });
  }

  if (removedInvalidRecord) {
    await queueCommunitySave();
  }
}

async function processCommunityTasks(discordClient) {
  if (!communityStoreReady || communityCheckRunning) {
    return;
  }

  communityCheckRunning = true;

  try {
    cleanupEventDrafts();
    await processCommunityCooldowns(discordClient);
    await processCommunityEvents(discordClient);

    for (
      const guildId of
      Object.keys(communityData.dashboards)
    ) {
      const guild =
        discordClient.guilds.cache.get(guildId) ??
        (await discordClient.guilds
          .fetch(guildId)
          .catch(() => null));

      if (!guild) continue;

      await updateDashboardMessage(guild).catch(error => {
        console.error(
          `Dashboard ${guildId} bijwerken mislukt:`,
          error.message,
        );
      });
    }
  } finally {
    communityCheckRunning = false;
  }
}

function getPointsEntry(messageId) {
  return pointsData.messages[messageId] ?? null;
}

function getGuildPointsStartTime(guildId) {
  return pointsData.guildStartedAt?.[guildId] ?? pointsData.startedAt;
}

function removeEmptyPointsEntry(messageId) {
  const entry = getPointsEntry(messageId);
  if (entry && !Object.keys(entry.users ?? {}).length) {
    delete pointsData.messages[messageId];
  }
}

function getManualPointsAdjustment(record) {
  const value =
    typeof record === 'number'
      ? record
      : record?.points;

  return Number.isSafeInteger(value) ? value : 0;
}

function calculatePointsTotals(guildId) {
  const totals = new Map();

  for (const entry of Object.values(pointsData.messages)) {
    if (
      entry.guildId !== guildId ||
      !Number.isInteger(entry.points) ||
      entry.points <= 0
    ) {
      continue;
    }

    for (const [userId, reactions] of Object.entries(entry.users ?? {})) {
      if (!Array.isArray(reactions) || !reactions.length) continue;
      totals.set(userId, (totals.get(userId) ?? 0) + entry.points);
    }
  }

  for (
    const [userId, record] of
    Object.entries(pointsData.manualPoints?.[guildId] ?? {})
  ) {
    const adjustedTotal =
      (totals.get(userId) ?? 0) +
      getManualPointsAdjustment(record);

    if (adjustedTotal > 0) {
      totals.set(userId, adjustedTotal);
    } else {
      totals.delete(userId);
    }
  }

  return totals;
}

async function changeManualPoints({
  guildId,
  userId,
  action,
  amount,
  changedBy,
  reason,
  eventId,
}) {
  const updateKey = `${guildId}:${userId}`;

  if (manualPointsUpdateInProgress.has(updateKey)) {
    const error = new Error(
      'Voor dit lid wordt al een puntenwijziging verwerkt.',
    );
    error.code = 'POINTS_UPDATE_BUSY';
    throw error;
  }

  manualPointsUpdateInProgress.add(updateKey);
  const previousData = JSON.stringify(pointsData);

  try {
    const changedAt = Date.now();
    const previousTotal =
      calculatePointsTotals(guildId).get(userId) ?? 0;

    if (action === 'aftrekken' && amount > previousTotal) {
      const error = new Error(
        `Dit lid heeft maar ${previousTotal} punten.`,
      );
      error.code = 'INSUFFICIENT_POINTS';
      error.availablePoints = previousTotal;
      throw error;
    }

    const change = action === 'toevoegen'
      ? amount
      : -amount;
    pointsData.manualPoints ??= {};
    pointsData.manualPoints[guildId] ??= {};
    const guildManualPoints =
      pointsData.manualPoints[guildId];
    const previousAdjustment =
      getManualPointsAdjustment(guildManualPoints[userId]);
    const newAdjustment = previousAdjustment + change;

    if (newAdjustment === 0) {
      delete guildManualPoints[userId];
    } else {
      guildManualPoints[userId] = {
        points: newAdjustment,
        updatedAt: new Date(changedAt).toISOString(),
        updatedBy: changedBy,
        lastAction: action,
        lastAmount: amount,
        lastReason: reason || null,
      };
    }

    if (!Object.keys(guildManualPoints).length) {
      delete pointsData.manualPoints[guildId];
    }

    applyDailyManualPointsChange({
      guildId,
      userId,
      change,
      eventId,
      timestamp: changedAt,
    });

    try {
      await queuePointsSave();
    } catch (error) {
      pointsData = JSON.parse(previousData);
      throw error;
    }

    const newTotal =
      calculatePointsTotals(guildId).get(userId) ?? 0;

    return {
      change,
      previousTotal,
      newTotal,
      manualAdjustment: newAdjustment,
    };
  } finally {
    manualPointsUpdateInProgress.delete(updateKey);
  }
}

async function resetGuildPoints(guildId, resetBy) {
  const previousData = JSON.stringify(pointsData);
  const guildEntries = Object.entries(pointsData.messages)
    .filter(([, entry]) => entry.guildId === guildId);
  const guildManualPoints = {
    ...(pointsData.manualPoints?.[guildId] ?? {}),
  };
  const manualAdjustmentCount =
    Object.keys(guildManualPoints).length;
  const guildAchievements = {
    ...(pointsData.achievements?.[guildId] ?? {}),
  };
  const achievementCount =
    countGuildPointsMilestones(guildAchievements);
  const dailyActivitySummary =
    summarizeDailyPointsActivities(guildId);
  const dailyPointsRecord = pointsData.dailyPoints?.[guildId]
    ? JSON.parse(
        JSON.stringify(pointsData.dailyPoints[guildId]),
      )
    : null;
  const totals = calculatePointsTotals(guildId);
  const participantCount = totals.size;
  const totalPoints = [...totals.values()]
    .reduce((sum, points) => sum + points, 0);
  let backupCreated = false;

  if (
    guildEntries.length ||
    manualAdjustmentCount ||
    achievementCount ||
    dailyActivitySummary.totalCount
  ) {
    const backupDirectory = join(
      dirname(POINTS_DATA_FILE),
      'backups',
    );
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = join(
      backupDirectory,
      `points-${guildId}-${timestamp}.json`,
    );
    const backup = {
      version: POINTS_DATA_VERSION,
      type: 'points-reset-backup',
      guildId,
      resetAt: new Date().toISOString(),
      resetBy,
      previousStartedAt: getGuildPointsStartTime(guildId),
      messages: Object.fromEntries(guildEntries),
      manualPoints: guildManualPoints,
      achievements: guildAchievements,
      dailyPoints: dailyPointsRecord,
    };

    await mkdir(backupDirectory, { recursive: true });
    await writeFile(
      backupFile,
      JSON.stringify(backup, null, 2),
      { encoding: 'utf8', flag: 'wx' },
    );
    backupCreated = true;
    console.log(`Puntenback-up gemaakt: ${backupFile}`);
  }

  for (const [messageId] of guildEntries) {
    delete pointsData.messages[messageId];
  }

  pointsData.guildStartedAt ??= {};
  pointsData.guildStartedAt[guildId] = Date.now();
  pointsData.manualPoints ??= {};
  delete pointsData.manualPoints[guildId];
  pointsData.achievements ??= {};
  delete pointsData.achievements[guildId];
  pointsData.dailyPoints ??= {};
  pointsData.dailyPoints[guildId] = {
    ...createDailyPointsRecord(Date.now(), {
      backfillCompleted: true,
    }),
    resetAt: new Date().toISOString(),
    resetBy,
  };

  try {
    await queuePointsSave();
  } catch (error) {
    pointsData = JSON.parse(previousData);
    throw error;
  }

  return {
    backupCreated,
    messageCount: guildEntries.length,
    participantCount,
    totalPoints,
    manualAdjustmentCount,
    achievementCount,
    dailyActivityCount: dailyActivitySummary.totalCount,
    dailyActivityPoints: dailyActivitySummary.totalPoints,
    dailyEventCount: dailyActivitySummary.event.count,
    dailyShopCount: dailyActivitySummary.winkel.count,
    dailyBankCount: dailyActivitySummary.bank.count,
    dailyActivityBreakdown: Object.fromEntries(
      POINTS_ACTIVITY_TYPE_KEYS.map(type => [
        type,
        { ...dailyActivitySummary[type] },
      ]),
    ),
  };
}

async function fetchCompleteReaction(reaction) {
  if (reaction.partial) {
    return reaction.fetch();
  }
  return reaction;
}

function shorten(value, maximum = 1024) {
  const text = String(value ?? 'Onbekend');
  return text.length > maximum
    ? `${text.slice(0, maximum - 3)}...`
    : text;
}

function formatUser(user) {
  return user
    ? `${user.tag ?? user.username ?? 'Onbekend'} (${user.id})`
    : 'Onbekend';
}

function formatEntity(entity, fallbackId) {
  if (!entity) {
    return fallbackId ? `ID: ${fallbackId}` : 'Onbekend';
  }

  if (typeof entity === 'string') {
    return shorten(entity);
  }

  const name =
    entity.tag ??
    entity.name ??
    entity.username ??
    entity.code ??
    'Onbekend';
  const id = entity.id ?? fallbackId;

  return id ? `${name} (${id})` : String(name);
}

async function sendLog(guild, category, embed) {
  const channelId = LOG_CHANNELS[category];
  if (!channelId) return;

  const channel =
    guild.channels.cache.get(channelId) ??
    (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel || typeof channel.send !== 'function') {
    console.error(`Geen toegang tot ${category}-logkanaal ${channelId}`);
    return;
  }

  await channel.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  }).catch(error => {
    console.error(`Kon ${category}-log niet versturen:`, error.message);
  });
}

function makeEmbed(category, title) {
  return new EmbedBuilder()
    .setColor(COLORS[category])
    .setTitle(shorten(title, 256))
    .setTimestamp();
}

const dealerNumberFormatter = new Intl.NumberFormat('nl-NL');

function formatDealerPrice(amount) {
  return `€${dealerNumberFormatter.format(amount)},-`;
}

function interactionMemberHasRole(interaction, roleId) {
  const roles = interaction.member?.roles;

  if (roles?.cache && typeof roles.cache.has === 'function') {
    return roles.cache.has(roleId);
  }

  return Array.isArray(roles) && roles.includes(roleId);
}

function memberCanUseStaffActions(interaction) {
  return interactionMemberHasRole(
    interaction,
    STAFF_ACTION_ROLE_ID,
  );
}

function getWarnRoleValidationError(guild, role) {
  if (!role || role.id === guild.id) {
    return 'Kies een geldige warnrol; @everyone is niet toegestaan.';
  }

  const allowedByConfiguration = WARN_ROLE_IDS.size
    ? WARN_ROLE_IDS.has(role.id)
    : WARN_ROLE_NAME_PATTERN.test(role.name ?? '');

  if (!allowedByConfiguration) {
    return WARN_ROLE_IDS.size
      ? 'Deze rol staat niet in `WARN_ROLE_IDS` en mag daarom niet ' +
          'als warnrol worden gebruikt.'
      : 'Kies een rol met “Warn” of “Waarschuwing” in de naam, of ' +
          'stel de toegestane rollen in via `WARN_ROLE_IDS`.';
  }

  if (role.managed) {
    return 'Deze rol wordt door Discord of een andere bot beheerd.';
  }

  const hasForbiddenPermission =
    WARN_ROLE_FORBIDDEN_PERMISSIONS.some(permission =>
      role.permissions?.has?.(permission, false) === true,
    );

  if (hasForbiddenPermission) {
    return 'Deze rol bevat beheerrechten en kan niet veilig als ' +
      'warnrol worden uitgedeeld.';
  }

  if (role.editable !== true) {
    return 'Ik kan deze rol niet beheren. Zet mijn botrol boven de ' +
      'warnrol en geef mij de permissie Rollen beheren.';
  }

  return null;
}

function cleanupDealerSessions() {
  const now = Date.now();

  for (const [sessionId, session] of dealerSessions) {
    if (session.expiresAt <= now) {
      dealerSessions.delete(sessionId);
    }
  }
}

function getDealerCartEntries(session) {
  return [...session.cart.entries()]
    .map(([itemId, quantity]) => ({
      item: DEALER_ITEMS.get(itemId),
      quantity,
    }))
    .filter(entry => entry.item)
    .sort((entryA, entryB) =>
      Number(entryA.item.categoryId) -
        Number(entryB.item.categoryId) ||
      entryA.item.name.localeCompare(
        entryB.item.name,
        'nl',
        { sensitivity: 'base' },
      ),
    );
}

function getDealerSalePrice(item) {
  return item.price + item.categoryMaximum;
}

function calculateDealerCartPricing(session) {
  return getDealerCartEntries(session).reduce(
    (pricing, entry) => {
      const baseSubtotal = entry.item.price * entry.quantity;
      const saleSubtotal =
        getDealerSalePrice(entry.item) * entry.quantity;

      pricing.baseTotal += baseSubtotal;
      pricing.maximumTotal += saleSubtotal - baseSubtotal;
      pricing.total += saleSubtotal;
      return pricing;
    },
    {
      baseTotal: 0,
      maximumTotal: 0,
      total: 0,
    },
  );
}

function calculateDealerCartTotal(session) {
  return calculateDealerCartPricing(session).total;
}

function buildDealerPanel(session) {
  const entries = getDealerCartEntries(session);
  const pricing = calculateDealerCartPricing(session);
  const totalQuantity = entries.reduce(
    (sum, entry) => sum + entry.quantity,
    0,
  );
  const selectedCategory = DEALER_CATALOG.find(
    category => category.id === session.categoryId,
  );
  const cartLines = entries.length
    ? entries.map(entry =>
        `• **${entry.quantity}x** ${entry.item.name} — ` +
        `${formatDealerPrice(
          getDealerSalePrice(entry.item) * entry.quantity,
        )}`,
      )
    : ['*Het winkelmandje is nog leeg.*'];
  const instructions = selectedCategory
    ? `Kies een artikel uit **${selectedCategory.name}**. ` +
      'Daarna kun je het aantal invullen.'
    : 'Kies eerst een categorie. Je kunt maximaal 25 verschillende ' +
      'artikelen toevoegen.';
  const notice = session.notice
    ? `\n\n${session.notice}`
    : '';

  const embed = new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle('Hollow Kings - Wapendealer')
    .setDescription(
      `**Klant:** <@${session.customerId}>\n` +
      `${instructions}\n\n` +
      `**Winkelmandje (${totalQuantity} stuks):**\n` +
      `${cartLines.join('\n')}\n\n` +
      `**Totale straatwaarde:** ` +
      `${formatDealerPrice(pricing.baseTotal)}\n` +
      `**Maximaal boven straatwaarde:** ` +
      `${formatDealerPrice(pricing.maximumTotal)}\n` +
      `**Totaalprijs:** ${formatDealerPrice(pricing.total)}` +
      notice,
    )
    .setFooter({ text: 'Het menu verloopt na 30 minuten' })
    .setTimestamp();
  const components = [];

  if (selectedCategory) {
    const itemSelect = new StringSelectMenuBuilder()
      .setCustomId(`dealer:item:${session.id}`)
      .setPlaceholder(`Kies uit ${selectedCategory.name}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        selectedCategory.items.map(item => ({
          label: shorten(item.name, 100),
          description:
            `Straat + max cat. ` +
            `${formatDealerPrice(item.categoryMaximum)} = ` +
            formatDealerPrice(getDealerSalePrice(item)),
          value: item.id,
        })),
      );

    components.push(
      new ActionRowBuilder().addComponents(itemSelect),
    );
  } else {
    const categorySelect = new StringSelectMenuBuilder()
      .setCustomId(`dealer:category:${session.id}`)
      .setPlaceholder('Kies een categorie')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        DEALER_CATALOG.map(category => ({
          label: category.name,
          description:
            `${category.items.length} artikelen • max +` +
            `${formatDealerPrice(category.categoryMaximum)}`,
          value: category.id,
        })),
      );

    components.push(
      new ActionRowBuilder().addComponents(categorySelect),
    );
  }

  const buttons = [];

  if (selectedCategory) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`dealer:back:${session.id}`)
        .setLabel('Categorieën')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`dealer:clear:${session.id}`)
      .setLabel('Mandje legen')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!session.cart.size),
    new ButtonBuilder()
      .setCustomId(`dealer:confirm:${session.id}`)
      .setLabel('Bestelling plaatsen')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!session.cart.size),
    new ButtonBuilder()
      .setCustomId(`dealer:cancel:${session.id}`)
      .setLabel('Annuleren')
      .setStyle(ButtonStyle.Danger),
  );

  components.push(
    new ActionRowBuilder().addComponents(buttons),
  );

  return {
    embeds: [embed],
    components,
    allowedMentions: { parse: [] },
  };
}

function buildDealerOrderEmbed(session) {
  const entries = getDealerCartEntries(session);
  const pricing = calculateDealerCartPricing(session);
  const totalQuantity = entries.reduce(
    (sum, entry) => sum + entry.quantity,
    0,
  );
  const orderLines = entries.map(entry => {
    const salePrice = getDealerSalePrice(entry.item);
    const subtotal = salePrice * entry.quantity;
    return (
      `• **${entry.quantity}x ${entry.item.name}**\n` +
      `  ${formatDealerPrice(entry.item.price)} straat + ` +
      `${formatDealerPrice(entry.item.categoryMaximum)} ` +
      `max. categorie = ${formatDealerPrice(salePrice)} per stuk — ` +
      `subtotaal ${formatDealerPrice(subtotal)}`
    );
  });

  return new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle('Hollow Kings - Wapenbestelling')
    .setDescription(orderLines.join('\n'))
    .addFields(
      {
        name: 'Dealer',
        value: `<@${session.dealerId}>`,
        inline: true,
      },
      {
        name: 'Klant',
        value: `<@${session.customerId}>`,
        inline: true,
      },
      {
        name: 'Aantal artikelen',
        value: String(totalQuantity),
        inline: true,
      },
      {
        name: 'Totale straatwaarde',
        value: formatDealerPrice(pricing.baseTotal),
        inline: true,
      },
      {
        name: 'Maximaal boven straatwaarde',
        value: formatDealerPrice(pricing.maximumTotal),
        inline: true,
      },
      {
        name: 'Totale prijs',
        value: `**${formatDealerPrice(pricing.total)}**`,
      },
    )
    .setTimestamp();
}

async function replyDealerError(interaction, content) {
  const payload = {
    content,
    flags: MessageFlags.Ephemeral,
  };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
}

async function getActiveDealerSession(interaction, sessionId) {
  cleanupDealerSessions();
  const session = dealerSessions.get(sessionId);

  if (!session) {
    await replyDealerError(
      interaction,
      'Dit wapendealermenu is verlopen. Gebruik `/wapendealer` opnieuw.',
    );
    return null;
  }

  if (
    session.dealerId !== interaction.user.id ||
    session.guildId !== interaction.guildId ||
    session.channelId !== interaction.channelId
  ) {
    await replyDealerError(
      interaction,
      'Dit wapendealermenu hoort niet bij jou.',
    );
    return null;
  }

  if (
    !WEAPON_DEALER_ROLE_ID ||
    !interactionMemberHasRole(interaction, WEAPON_DEALER_ROLE_ID)
  ) {
    dealerSessions.delete(sessionId);
    await replyDealerError(
      interaction,
      'Je hebt de ingestelde wapendealerrol niet meer.',
    );
    return null;
  }

  session.expiresAt = Date.now() + DEALER_SESSION_DURATION_MS;
  return session;
}

function parseAbsenceDate(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);

  if (!match) return null;

  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    day,
    month,
    year,
    timestamp,
    display:
      `${String(day).padStart(2, '0')}-` +
      `${String(month).padStart(2, '0')}-${year}`,
  };
}

function calculateAbsenceDurationDays(startDate, endDate) {
  return (
    Math.floor(
      (endDate.timestamp - startDate.timestamp) /
      (24 * 60 * 60 * 1000),
    ) + 1
  );
}

function buildAbsenceRequestEmbed({
  user,
  startDate,
  endDate,
  reason,
  details,
}) {
  const durationDays =
    calculateAbsenceDurationDays(startDate, endDate);

  return new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle('Hollow Kings - Afwezigheidsaanvraag')
    .setDescription(
      'Een ganglid heeft een afwezigheidsaanvraag ingediend.',
    )
    .addFields(
      {
        name: 'Ganglid',
        value: `<@${user.id}>`,
        inline: true,
      },
      {
        name: 'Startdatum',
        value: startDate.display,
        inline: true,
      },
      {
        name: 'Einddatum',
        value: endDate.display,
        inline: true,
      },
      {
        name: 'Duur',
        value:
          `${durationDays} ${durationDays === 1 ? 'dag' : 'dagen'}`,
        inline: true,
      },
      {
        name: 'Reden',
        value: shorten(reason, 1024),
      },
      {
        name: 'Extra toelichting',
        value: shorten(details || 'Geen extra toelichting', 1024),
      },
      {
        name: 'Status',
        value: '🟡 In behandeling',
      },
    )
    .setFooter({
      text: `Ingediend door ${user.tag ?? user.username ?? user.id}`,
    })
    .setTimestamp();
}

function buildReviewedAbsenceEmbed(originalEmbed, action, reviewer) {
  const approved = action === 'approve';
  const embed = EmbedBuilder.from(originalEmbed);
  const fields = (embed.data.fields ?? [])
    .filter(field => field.name !== 'Beoordeeld door')
    .map(field =>
      field.name === 'Status'
        ? {
            ...field,
            value: approved ? '✅ Goedgekeurd' : '❌ Afgewezen',
          }
        : field,
    );

  fields.push({
    name: 'Beoordeeld door',
    value: `<@${reviewer.id}>`,
  });

  return embed
    .setColor(approved ? 0x57F287 : 0xED4245)
    .setTitle(
      approved
        ? 'Hollow Kings - Afwezigheid goedgekeurd'
        : 'Hollow Kings - Afwezigheid afgewezen',
    )
    .setFields(fields)
    .setTimestamp();
}

function parseProcessingRequestTime(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^([01]?\d|2[0-3])[:.](\d{2})$/);

  if (!match) return null;

  return (
    `${String(Number.parseInt(match[1], 10)).padStart(2, '0')}:` +
    match[2]
  );
}

function buildProcessingRequestEmbed({
  user,
  name,
  requestTime,
  portoCount,
  amount,
  requestDate,
}) {
  return new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle('📋 Aanvraag Verwerk')
    .setDescription(
      'Er is een nieuwe aanvraag om te verwerken ingediend.',
    )
    .addFields(
      {
        name: 'Naam',
        value: shorten(name, 1024),
      },
      {
        name: 'Tijdstip aanvraag',
        value: requestTime,
        inline: true,
      },
      {
        name: 'Hoeveel man porto',
        value: String(portoCount),
        inline: true,
      },
      {
        name: 'Hoeveelheid',
        value: shorten(amount, 1024),
        inline: true,
      },
      {
        name: 'Datum',
        value: requestDate.display.replaceAll('-', '/'),
        inline: true,
      },
      {
        name: 'Ingediend door',
        value: `<@${user.id}>`,
      },
      {
        name: 'Status',
        value: '🟡 In behandeling',
      },
    )
    .setFooter({
      text: `Ingediend door ${user.tag ?? user.username ?? user.id}`,
    })
    .setTimestamp();
}

function buildReviewedProcessingRequestEmbed(
  originalEmbed,
  action,
  reviewer,
) {
  const approved = action === 'approve';
  const embed = EmbedBuilder.from(originalEmbed);
  const fields = (embed.data.fields ?? [])
    .filter(field => field.name !== 'Beoordeeld door')
    .map(field =>
      field.name === 'Status'
        ? {
            ...field,
            value: approved ? '✅ Goedgekeurd' : '❌ Afgekeurd',
          }
        : field,
    );

  fields.push({
    name: 'Beoordeeld door',
    value: `<@${reviewer.id}>`,
  });

  return embed
    .setColor(approved ? 0x57F287 : 0xED4245)
    .setTitle(
      approved
        ? '✅ Aanvraag Verwerk — Goedgekeurd'
        : '❌ Aanvraag Verwerk — Afgekeurd',
    )
    .setFields(fields)
    .setTimestamp();
}

async function sendPointsActivityLog({
  guild,
  user,
  message,
  pointsChange,
  emoji,
}) {
  const newTotal =
    calculatePointsTotals(guild.id).get(user.id) ?? 0;
  const isAward = pointsChange > 0;
  const amount = Math.abs(pointsChange);
  const messageUrl =
    `https://discord.com/channels/${guild.id}/` +
    `${message.channelId}/${message.id}`;

  const embed = makeEmbed(
    'pointsActivity',
    isAward ? 'Punten toegekend' : 'Punten afgetrokken',
  ).addFields(
    {
      name: 'Lid',
      value:
        `<@${user.id}> — ` +
        `${user.tag ?? user.username ?? user.id}`,
    },
    {
      name: 'Wijziging',
      value: `${isAward ? '+' : '-'}${amount} punten`,
      inline: true,
    },
    {
      name: 'Nieuw totaal',
      value: `${newTotal} punten`,
      inline: true,
    },
    {
      name: 'Reactie',
      value: `${emoji} ${isAward ? 'toegevoegd' : 'verwijderd'}`,
      inline: true,
    },
    {
      name: 'Puntenbericht',
      value: `[Open het originele bericht](${messageUrl})`,
    },
    {
      name: 'Inhoud',
      value: shorten(message.content || '*Geen tekst beschikbaar*'),
    },
  );

  await sendLog(guild, 'pointsActivity', embed);
}

async function resolvePointsAchievementDestination(guild) {
  if (!POINTS_ACHIEVEMENT_CHANNEL_ID) return null;

  const channel =
    guild.channels.cache.get(POINTS_ACHIEVEMENT_CHANNEL_ID) ??
    (await guild.channels
      .fetch(POINTS_ACHIEVEMENT_CHANNEL_ID)
      .catch(() => null));

  if (!channel || typeof channel.send !== 'function') {
    return null;
  }

  let leadershipRole = null;

  if (POINTS_ACHIEVEMENT_ROLE_ID) {
    const role =
      guild.roles.cache.get(POINTS_ACHIEVEMENT_ROLE_ID) ??
      (await guild.roles
        .fetch(POINTS_ACHIEVEMENT_ROLE_ID)
        .catch(() => null));
    const botMember = guild.members.me;
    const botPermissions =
      botMember &&
      typeof channel.permissionsFor === 'function'
        ? channel.permissionsFor(botMember)
        : null;

    if (
      role &&
      (
        role.mentionable ||
        botPermissions?.has(
          PermissionFlagsBits.MentionEveryone,
        )
      )
    ) {
      leadershipRole = role;
    }
  }

  return {
    channel,
    leadershipRole,
  };
}

function getGuildPointsAchievements(guildId) {
  pointsData.achievements ??= {};
  pointsData.achievements[guildId] ??= {};
  return pointsData.achievements[guildId];
}

function normalizeUserPointsAchievementRecord(
  record,
  userId,
) {
  if (
    record?.milestones &&
    typeof record.milestones === 'object' &&
    !Array.isArray(record.milestones)
  ) {
    return {
      ...record,
      userId,
      milestones: record.milestones,
    };
  }

  const milestones = {};

  if (record && typeof record === 'object') {
    milestones[String(POINTS_FIRST_ACHIEVEMENT)] = {
      ...record,
      threshold: POINTS_FIRST_ACHIEVEMENT,
    };
  }

  return {
    userId,
    milestones,
  };
}

function getUserPointsAchievementRecord(
  guildId,
  userId,
  { create = false } = {},
) {
  const guildAchievements =
    getGuildPointsAchievements(guildId);
  const existing = guildAchievements[userId];

  if (!existing && !create) return null;

  const normalized =
    normalizeUserPointsAchievementRecord(
      existing,
      userId,
    );

  guildAchievements[userId] = normalized;
  return normalized;
}

function getAchievedPointsMilestones(guildId, userId) {
  const record =
    getUserPointsAchievementRecord(guildId, userId);

  return new Set(
    Object.keys(record?.milestones ?? {})
      .map(value => Number.parseInt(value, 10))
      .filter(Number.isSafeInteger),
  );
}

function countGuildPointsMilestones(guildAchievements) {
  return Object.entries(guildAchievements)
    .reduce((count, [userId, record]) => {
      const normalized =
        normalizeUserPointsAchievementRecord(
          record,
          userId,
        );
      return (
        count +
        Object.keys(normalized.milestones).length
      );
    }, 0);
}

function buildPointsAchievementEmbed({
  guild,
  user,
  totalPoints,
  milestone,
  reachedAt,
  periodStartedAt,
}) {
  const { threshold } = milestone;
  const nextMilestone =
    POINTS_ACHIEVEMENT_MILESTONES.find(
      entry => entry.threshold > threshold,
    );
  let description;

  if (threshold === 150) {
    description = [
      '## 👑 EEN NIEUWE Hollow Kings LEGEND 👑',
      `<@${user.id}> heeft de ultieme grens van ` +
        '**150 punten** bereikt.',
      '',
      '> **150 punten. Maximale inzet. Onbetwiste loyaliteit.**',
      '',
      '🔥 Deze uitzonderlijke prestatie wordt officieel erkend ' +
        'door **Hollow Kings**. Een status die je niet krijgt, ' +
        'maar verdient.',
    ].join('\n');
  } else if (threshold === 100) {
    description = [
      '## 💎 ELITE STATUS ONTGRENDELD',
      `Gefeliciteerd <@${user.id}>! Met **100 punten** behoor je ` +
        'vanaf nu tot de puntenelite van **Hollow Kings**.',
      '',
      '**Inzet, discipline en loyaliteit hebben je hier gebracht.**',
    ].join('\n');
  } else {
    description = [
      '## 🎯 EERSTE GROTE MIJLPAAL',
      `Gefeliciteerd <@${user.id}>! Je hebt de grens van ` +
        '**50 punten** bereikt.',
      '',
      'Een sterke prestatie en de eerste grote stap richting de top.',
    ].join('\n');
  }

  const embed = new EmbedBuilder()
    .setColor(milestone.color)
    .setTitle(milestone.title)
    .setDescription(description)
    .addFields(
      {
        name: '👤 Lid',
        value: formatUser(user),
      },
      {
        name: '⭐ Huidig puntentotaal',
        value: `**${totalPoints} punten**`,
        inline: true,
      },
      {
        name: '🏅 Behaalde status',
        value:
          `**${threshold} punten • ${milestone.name}**`,
        inline: true,
      },
      {
        name: '🗓️ Puntenperiode gestart',
        value:
          `<t:${Math.floor(periodStartedAt / 1000)}:F>`,
      },
    )
    .setFooter({
      text: 'Hollow Kings • Puntenprestatie',
    })
    .setTimestamp(reachedAt);

  if (nextMilestone) {
    embed.addFields({
      name: '🚀 Volgende mijlpaal',
      value:
        `Nog **${Math.max(
          0,
          nextMilestone.threshold - totalPoints,
        )} punten** tot **${nextMilestone.threshold} • ` +
        `${nextMilestone.name}**.`,
    });
  } else {
    embed.addFields({
      name: '👑 LEGENDARY ERKENNING',
      value:
        '**De hoogste Hollow Kings-puntenmijlpaal is officieel behaald.**',
    });
  }

  const avatarUrl =
    typeof user.displayAvatarURL === 'function'
      ? user.displayAvatarURL({ size: 512 })
      : null;
  const guildIcon =
    typeof guild.iconURL === 'function'
      ? guild.iconURL({ size: 256 })
      : null;

  if (avatarUrl) {
    embed.setThumbnail(avatarUrl);
  }

  if (guildIcon) {
    embed.setAuthor({
      name: 'Hollow Kings • Officiële prestatie',
      iconURL: guildIcon,
    });
  }

  return embed;
}

async function maybeSendPointsAchievement({
  guild,
  user,
  totalPoints,
}) {
  if (
    !Number.isInteger(totalPoints) ||
    totalPoints < POINTS_FIRST_ACHIEVEMENT
  ) {
    return null;
  }

  const achievementKey = `${guild.id}:${user.id}`;
  const achievedMilestones =
    getAchievedPointsMilestones(guild.id, user.id);
  const pendingMilestones =
    POINTS_ACHIEVEMENT_MILESTONES.filter(
      milestone =>
        totalPoints >= milestone.threshold &&
        !achievedMilestones.has(milestone.threshold),
    );

  if (
    !pendingMilestones.length ||
    pointsAchievementInProgress.has(achievementKey)
  ) {
    return null;
  }

  pointsAchievementInProgress.add(achievementKey);
  const sentMessages = [];
  const sentMilestones = [];

  try {
    const destination =
      await resolvePointsAchievementDestination(guild);

    if (!destination) {
      throw new Error(
        `geen toegang tot punten-behaald-kanaal ` +
        `${POINTS_ACHIEVEMENT_CHANNEL_ID || 'niet ingesteld'}`,
      );
    }

    const periodStartedAt =
      getGuildPointsStartTime(guild.id);
    const guildAchievements =
      getGuildPointsAchievements(guild.id);
    const userAchievements =
      getUserPointsAchievementRecord(
        guild.id,
        user.id,
        { create: true },
      );

    for (const milestone of pendingMilestones) {
      const reachedAt = Date.now();
      const achievementEmbed =
        buildPointsAchievementEmbed({
          guild,
          user,
          totalPoints,
          milestone,
          reachedAt,
          periodStartedAt,
        });
      const mentionParts =
        milestone.threshold ===
        POINTS_HIGHEST_ACHIEVEMENT
          ? ['👑🔥', `<@${user.id}>`]
          : [`<@${user.id}>`];
      const allowedRoles = [];

      if (destination.leadershipRole) {
        mentionParts.push(
          `<@&${destination.leadershipRole.id}>`,
        );
        allowedRoles.push(destination.leadershipRole.id);
      }

      if (
        milestone.threshold ===
        POINTS_HIGHEST_ACHIEVEMENT
      ) {
        mentionParts.push('🔥👑');
      }

      const achievementMessage =
        await destination.channel.send({
          content: mentionParts.join(' '),
          embeds: [achievementEmbed],
          allowedMentions: {
            parse: [],
            users: [user.id],
            roles: allowedRoles,
          },
        });
      const milestoneKey =
        String(milestone.threshold);

      userAchievements.milestones[milestoneKey] = {
        threshold: milestone.threshold,
        name: milestone.name,
        totalPoints,
        reachedAt,
        channelId: destination.channel.id,
        messageId: achievementMessage.id,
      };

      try {
        await queuePointsSave();
      } catch (error) {
        delete userAchievements.milestones[milestoneKey];

        if (
          !Object.keys(userAchievements.milestones).length
        ) {
          delete guildAchievements[user.id];
        }

        if (!Object.keys(guildAchievements).length) {
          delete pointsData.achievements[guild.id];
        }

        await achievementMessage.delete?.().catch(() => {});
        throw error;
      }

      for (const emoji of milestone.reactions) {
        await achievementMessage
          .react?.(emoji)
          .catch(() => {});
      }

      sentMessages.push(achievementMessage);
      sentMilestones.push(milestone);
    }

    return {
      messages: sentMessages,
      milestones: sentMilestones,
    };
  } finally {
    pointsAchievementInProgress.delete(achievementKey);
  }
}

async function processExistingPointsAchievements(
  discordClient,
) {
  for (const guild of discordClient.guilds.cache.values()) {
    const totals = calculatePointsTotals(guild.id);

    for (const [userId, totalPoints] of totals) {
      if (totalPoints < POINTS_FIRST_ACHIEVEMENT) {
        continue;
      }

      const achievedMilestones =
        getAchievedPointsMilestones(guild.id, userId);
      const hasPendingMilestone =
        POINTS_ACHIEVEMENT_MILESTONES.some(
          milestone =>
            totalPoints >= milestone.threshold &&
            !achievedMilestones.has(milestone.threshold),
        );

      if (!hasPendingMilestone) {
        continue;
      }

      const member =
        guild.members.cache.get(userId) ??
        (await guild.members
          .fetch(userId)
          .catch(() => null));

      if (
        !member ||
        member.user?.bot ||
        !memberHasGangRole(member)
      ) {
        continue;
      }

      await maybeSendPointsAchievement({
        guild,
        user: member.user,
        totalPoints,
      }).catch(error => {
        console.error(
          `Bestaande puntenprestatie voor ${userId} ` +
          `versturen mislukt:`,
          error.message,
        );
      });
    }
  }
}

function isPointsAchievementMessage(message, guild) {
  const botId = guild.members.me?.id ?? client.user?.id;

  if (!botId || message.author?.id !== botId) {
    return false;
  }

  return (message.embeds ?? []).some(embed => {
    const title = embed.title ?? embed.data?.title;
    const footerText =
      embed.footer?.text ?? embed.data?.footer?.text;

    return (
      title === '🏆 50 punten behaald!' ||
      footerText === 'Hollow Kings • Puntenprestatie'
    );
  });
}

async function clearPointsAchievementChannel(guild) {
  if (!POINTS_ACHIEVEMENT_CHANNEL_ID) {
    return {
      status: 'not-configured',
      deleted: 0,
      failed: 0,
    };
  }

  const channel =
    guild.channels.cache.get(POINTS_ACHIEVEMENT_CHANNEL_ID) ??
    (await guild.channels
      .fetch(POINTS_ACHIEVEMENT_CHANNEL_ID)
      .catch(() => null));

  if (
    !channel ||
    typeof channel.messages?.fetch !== 'function'
  ) {
    return {
      status: 'unavailable',
      deleted: 0,
      failed: 0,
    };
  }

  let before;
  let deleted = 0;
  let failed = 0;

  for (let page = 0; page < 100; page += 1) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
    });
    const messages = [...fetched.values()];

    if (!messages.length) break;

    for (const message of messages) {
      if (!isPointsAchievementMessage(message, guild)) {
        continue;
      }

      try {
        await message.delete();
        deleted += 1;
      } catch {
        failed += 1;
      }
    }

    before = messages.at(-1)?.id;

    if (messages.length < 100 || !before) break;
  }

  return {
    status: failed ? 'partial' : 'cleared',
    deleted,
    failed,
  };
}

function backupJsonSafe(value) {
  return JSON.parse(
    JSON.stringify(
      value,
      (_key, item) =>
        typeof item === 'bigint' ? item.toString() : item,
    ),
  );
}

function serializeBackupRole(role) {
  return {
    id: role.id,
    name: role.name,
    position: role.rawPosition ?? role.position ?? 0,
    color: role.color ?? 0,
    hoist: Boolean(role.hoist),
    mentionable: Boolean(role.mentionable),
    managed: Boolean(role.managed),
    permissions: role.permissions?.bitfield?.toString?.() ?? '0',
    unicodeEmoji: role.unicodeEmoji ?? null,
    iconURL: role.iconURL?.({ extension: 'png', size: 256 }) ?? null,
    tags: role.tags ? backupJsonSafe(role.tags) : null,
  };
}

function serializeBackupOverwrite(overwrite) {
  return {
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow?.bitfield?.toString?.() ?? '0',
    deny: overwrite.deny?.bitfield?.toString?.() ?? '0',
  };
}

function serializeBackupChannel(channel) {
  const availableTags = Array.isArray(channel.availableTags)
    ? channel.availableTags.map(tag => ({
        id: tag.id,
        name: tag.name,
        moderated: Boolean(tag.moderated),
        emojiId: tag.emoji?.id ?? tag.emojiId ?? null,
        emojiName: tag.emoji?.name ?? tag.emojiName ?? null,
      }))
    : [];

  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    typeName: ChannelType[channel.type] ?? String(channel.type),
    position: channel.rawPosition ?? channel.position ?? 0,
    parentId: channel.parentId ?? null,
    topic: channel.topic ?? null,
    nsfw: Boolean(channel.nsfw),
    rateLimitPerUser: channel.rateLimitPerUser ?? 0,
    bitrate: channel.bitrate ?? null,
    userLimit: channel.userLimit ?? null,
    rtcRegion: channel.rtcRegion ?? null,
    videoQualityMode: channel.videoQualityMode ?? null,
    defaultAutoArchiveDuration:
      channel.defaultAutoArchiveDuration ?? null,
    defaultThreadRateLimitPerUser:
      channel.defaultThreadRateLimitPerUser ?? null,
    defaultSortOrder: channel.defaultSortOrder ?? null,
    defaultForumLayout: channel.defaultForumLayout ?? null,
    defaultReactionEmoji: channel.defaultReactionEmoji
      ? backupJsonSafe(channel.defaultReactionEmoji)
      : null,
    availableTags,
    flags: channel.flags?.bitfield?.toString?.() ?? null,
    permissionOverwrites: channel.permissionOverwrites?.cache
      ? [...channel.permissionOverwrites.cache.values()].map(
          serializeBackupOverwrite,
        )
      : [],
    thread: channel.isThread?.()
      ? {
          archived: Boolean(channel.archived),
          locked: Boolean(channel.locked),
          invitable: channel.invitable ?? null,
          autoArchiveDuration: channel.autoArchiveDuration ?? null,
          archiveTimestamp: channel.archiveTimestamp ?? null,
          ownerId: channel.ownerId ?? null,
          appliedTags: [...(channel.appliedTags ?? [])],
        }
      : null,
  };
}

function serializeBackupMessage(message) {
  return {
    id: message.id,
    channelId: message.channelId,
    author: {
      id: message.author?.id ?? null,
      username: message.author?.username ?? 'Onbekend',
      displayName:
        message.member?.displayName ??
        message.author?.globalName ??
        message.author?.username ??
        'Onbekend',
      tag: message.author?.tag ?? null,
      bot: Boolean(message.author?.bot),
      avatarURL:
        message.author?.displayAvatarURL?.({
          extension: 'png',
          size: 128,
        }) ?? null,
    },
    content: message.content ?? '',
    createdTimestamp: message.createdTimestamp ?? null,
    editedTimestamp: message.editedTimestamp ?? null,
    pinned: Boolean(message.pinned),
    tts: Boolean(message.tts),
    type: message.type,
    flags: message.flags?.bitfield?.toString?.() ?? null,
    reference: message.reference
      ? backupJsonSafe(message.reference)
      : null,
    attachments: message.attachments
      ? [...message.attachments.values()].map(attachment => ({
          id: attachment.id,
          name: attachment.name,
          description: attachment.description ?? null,
          url: attachment.url,
          proxyURL: attachment.proxyURL ?? null,
          contentType: attachment.contentType ?? null,
          size: attachment.size ?? null,
          width: attachment.width ?? null,
          height: attachment.height ?? null,
          duration: attachment.duration ?? null,
          waveform: attachment.waveform ?? null,
        }))
      : [],
    embeds: (message.embeds ?? []).map(embed =>
      typeof embed.toJSON === 'function'
        ? embed.toJSON()
        : backupJsonSafe(embed),
    ),
    components: (message.components ?? []).map(component =>
      typeof component.toJSON === 'function'
        ? component.toJSON()
        : backupJsonSafe(component),
    ),
    stickers: message.stickers
      ? [...message.stickers.values()].map(sticker => ({
          id: sticker.id,
          name: sticker.name,
          format: sticker.format,
          url: sticker.url,
        }))
      : [],
    reactions: message.reactions?.cache
      ? [...message.reactions.cache.values()].map(reaction => ({
          emoji: {
            id: reaction.emoji.id ?? null,
            name: reaction.emoji.name ?? null,
            animated: Boolean(reaction.emoji.animated),
          },
          count: reaction.count,
          me: Boolean(reaction.me),
        }))
      : [],
  };
}

async function fetchAllBackupMessages(channel, onPage) {
  const messages = [];
  let before;

  while (true) {
    const fetched = await channel.messages.fetch({
      limit: 100,
      ...(before ? { before } : {}),
      cache: false,
    });
    const batch = [...fetched.values()];

    if (!batch.length) break;

    messages.push(...batch.map(serializeBackupMessage));
    await onPage?.(batch.length);
    before = batch.at(-1)?.id;

    if (batch.length < 100 || !before) break;
  }

  return messages.sort(
    (first, second) =>
      (first.createdTimestamp ?? 0) -
      (second.createdTimestamp ?? 0),
  );
}

async function discoverBackupThreads(guild, baseChannels, warnings) {
  const threads = new Map();

  try {
    const active = await guild.channels.fetchActiveThreads(false);
    for (const thread of active.threads.values()) {
      threads.set(thread.id, thread);
    }
  } catch (error) {
    warnings.push(
      `Actieve threads ophalen mislukt: ${error.message}`,
    );
  }

  for (const channel of baseChannels.values()) {
    if (typeof channel?.threads?.fetchArchived !== 'function') {
      continue;
    }

    for (const type of ['public', 'private']) {
      try {
        const archived = await channel.threads.fetchArchived({
          type,
          fetchAll: true,
        });
        for (const thread of archived.threads.values()) {
          threads.set(thread.id, thread);
        }
      } catch (error) {
        if (type === 'public') {
          warnings.push(
            `Gearchiveerde threads van #${channel.name} ` +
            `ophalen mislukt: ${error.message}`,
          );
        }
      }
    }
  }

  return threads;
}

function captureBackupBotData(guildId) {
  return {
    points: {
      startedAt: pointsData.startedAt,
      guildStartedAt:
        pointsData.guildStartedAt?.[guildId] ?? null,
      messages: Object.fromEntries(
        Object.entries(pointsData.messages ?? {}).filter(
          ([, entry]) => entry?.guildId === guildId,
        ),
      ),
      manualPoints:
        pointsData.manualPoints?.[guildId] ?? {},
      achievements:
        pointsData.achievements?.[guildId] ?? {},
      dailyPoints:
        pointsData.dailyPoints?.[guildId] ?? null,
    },
    absences: Object.fromEntries(
      Object.entries(absenceData.approved ?? {}).filter(
        ([, record]) => record?.guildId === guildId,
      ),
    ),
    processingReminders: Object.fromEntries(
      Object.entries(processingReminderData.pending ?? {}).filter(
        ([, record]) => record?.guildId === guildId,
      ),
    ),
    giveaways: Object.fromEntries(
      Object.entries(giveawayData.active ?? {}).filter(
        ([, record]) => record?.guildId === guildId,
      ),
    ),
    community: {
      dashboards: Object.fromEntries(
        Object.entries(communityData.dashboards ?? {}).filter(
          ([key, record]) =>
            key === guildId || record?.guildId === guildId,
        ),
      ),
      events: Object.fromEntries(
        Object.entries(communityData.events ?? {}).filter(
          ([, record]) => record?.guildId === guildId,
        ),
      ),
      cooldowns: Object.fromEntries(
        Object.entries(communityData.cooldowns ?? {}).filter(
          ([key, record]) =>
            key === guildId || record?.guildId === guildId,
        ),
      ),
    },
  };
}

async function buildRobinServerBackup({
  guild,
  createdBy,
  includeMessages = true,
  onProgress,
}) {
  const warnings = [];
  await onProgress?.('Serverinstellingen en rollen verzamelen…');

  const freshGuild = await guild.fetch().catch(() => guild);
  const roles = await guild.roles.fetch().catch(error => {
    warnings.push(`Rollen ophalen mislukt: ${error.message}`);
    return guild.roles.cache;
  });
  const baseChannels = await guild.channels.fetch().catch(error => {
    warnings.push(`Kanalen ophalen mislukt: ${error.message}`);
    return guild.channels.cache;
  });
  const validBaseChannels = new Map(
    [...baseChannels.entries()].filter(([, channel]) => channel),
  );
  const threads = await discoverBackupThreads(
    guild,
    validBaseChannels,
    warnings,
  );

  await onProgress?.('Leden, bots en serveronderdelen verzamelen…');
  const members = await guild.members.fetch().catch(error => {
    warnings.push(`Leden ophalen mislukt: ${error.message}`);
    return guild.members.cache;
  });

  const emojis = await guild.emojis.fetch().catch(error => {
    warnings.push(`Emoji’s ophalen mislukt: ${error.message}`);
    return guild.emojis.cache;
  });
  const stickers = await guild.stickers.fetch().catch(error => {
    warnings.push(`Stickers ophalen mislukt: ${error.message}`);
    return guild.stickers.cache;
  });
  const soundboardSounds = await guild.soundboardSounds
    .fetch()
    .catch(error => {
      warnings.push(`Soundboard ophalen mislukt: ${error.message}`);
      return guild.soundboardSounds.cache;
    });
  const autoModerationRules = await guild.autoModerationRules
    .fetch()
    .catch(error => {
      warnings.push(`AutoMod ophalen mislukt: ${error.message}`);
      return guild.autoModerationRules.cache;
    });
  const scheduledEvents = await guild.scheduledEvents
    .fetch()
    .catch(error => {
      warnings.push(`Evenementen ophalen mislukt: ${error.message}`);
      return guild.scheduledEvents.cache;
    });
  const bans = await guild.bans.fetch().catch(error => {
    warnings.push(`Bans ophalen mislukt: ${error.message}`);
    return new Map();
  });
  const webhooks = await guild.fetchWebhooks().catch(error => {
    warnings.push(`Webhooks ophalen mislukt: ${error.message}`);
    return new Map();
  });
  const integrations = await guild.fetchIntegrations().catch(error => {
    warnings.push(`Integraties ophalen mislukt: ${error.message}`);
    return new Map();
  });
  const invites = await guild.invites.fetch(false).catch(error => {
    warnings.push(`Invites ophalen mislukt: ${error.message}`);
    return new Map();
  });
  const commands = await guild.commands.fetch().catch(error => {
    warnings.push(`Eigen commands ophalen mislukt: ${error.message}`);
    return new Map();
  });

  const allChannels = new Map([
    ...validBaseChannels,
    ...threads,
  ]);
  const messageArchive = {};
  let totalMessages = 0;

  if (includeMessages) {
    const messageChannels = [...allChannels.values()]
      .filter(channel =>
        channel?.isTextBased?.() &&
        typeof channel.messages?.fetch === 'function',
      )
      .sort(
        (first, second) =>
          (first.rawPosition ?? 0) -
          (second.rawPosition ?? 0),
      );

    for (const [index, channel] of messageChannels.entries()) {
      await onProgress?.(
        `Berichten archiveren: ${index + 1}/${messageChannels.length} ` +
        `(#${channel.name}) • ${totalMessages} opgeslagen`,
      );

      try {
        const messages = await fetchAllBackupMessages(
          channel,
          async amount => {
            totalMessages += amount;
            if (totalMessages % 1000 < amount) {
              await onProgress?.(
                `Berichten archiveren: ${totalMessages} opgeslagen…`,
              );
            }
          },
        );
        messageArchive[channel.id] = messages;
      } catch (error) {
        warnings.push(
          `Berichten uit #${channel.name} niet volledig opgehaald: ` +
          error.message,
        );
      }
    }
  }

  const serializedChannels = [
    ...validBaseChannels.values(),
  ].map(serializeBackupChannel);
  const serializedThreads = [...threads.values()].map(
    serializeBackupChannel,
  );
  const serializedMembers = [...members.values()].map(member => ({
    id: member.id,
    username: member.user?.username ?? 'Onbekend',
    tag: member.user?.tag ?? null,
    bot: Boolean(member.user?.bot),
    nickname: member.nickname ?? null,
    displayName: member.displayName ?? null,
    joinedTimestamp: member.joinedTimestamp ?? null,
    premiumSinceTimestamp: member.premiumSinceTimestamp ?? null,
    communicationDisabledUntilTimestamp:
      member.communicationDisabledUntilTimestamp ?? null,
    roles: member.roles?.cache
      ? [...member.roles.cache.keys()].filter(id => id !== guild.id)
      : [],
  }));

  const backup = {
    format: SERVER_BACKUP_FORMAT,
    version: SERVER_BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    createdBy: {
      id: createdBy?.id ?? null,
      username: createdBy?.username ?? null,
      tag: createdBy?.tag ?? null,
    },
    sourceGuildId: guild.id,
    guild: {
      id: guild.id,
      name: freshGuild.name,
      description: freshGuild.description ?? null,
      ownerId: freshGuild.ownerId,
      iconURL: freshGuild.iconURL?.({ extension: 'png', size: 1024 }) ?? null,
      bannerURL:
        freshGuild.bannerURL?.({ extension: 'png', size: 1024 }) ?? null,
      splashURL:
        freshGuild.splashURL?.({ extension: 'png', size: 1024 }) ?? null,
      discoverySplashURL:
        freshGuild.discoverySplashURL?.({
          extension: 'png',
          size: 1024,
        }) ?? null,
      verificationLevel: freshGuild.verificationLevel,
      explicitContentFilter: freshGuild.explicitContentFilter,
      defaultMessageNotifications:
        freshGuild.defaultMessageNotifications,
      afkTimeout: freshGuild.afkTimeout,
      afkChannelId: freshGuild.afkChannelId ?? null,
      systemChannelId: freshGuild.systemChannelId ?? null,
      systemChannelFlags:
        freshGuild.systemChannelFlags?.bitfield?.toString?.() ?? '0',
      rulesChannelId: freshGuild.rulesChannelId ?? null,
      publicUpdatesChannelId:
        freshGuild.publicUpdatesChannelId ?? null,
      safetyAlertsChannelId:
        freshGuild.safetyAlertsChannelId ?? null,
      preferredLocale: freshGuild.preferredLocale ?? null,
      premiumProgressBarEnabled:
        Boolean(freshGuild.premiumProgressBarEnabled),
      features: [...(freshGuild.features ?? [])],
    },
    roles: [...roles.values()]
      .map(serializeBackupRole)
      .sort((first, second) => first.position - second.position),
    channels: serializedChannels.sort(
      (first, second) => first.position - second.position,
    ),
    threads: serializedThreads,
    members: serializedMembers,
    bots: serializedMembers.filter(member => member.bot),
    emojis: [...emojis.values()].map(emoji => ({
      id: emoji.id,
      name: emoji.name,
      animated: Boolean(emoji.animated),
      available: emoji.available ?? null,
      managed: Boolean(emoji.managed),
      requiresColons: emoji.requiresColons ?? null,
      roles: emoji.roles?.cache
        ? [...emoji.roles.cache.keys()]
        : [],
      url: emoji.imageURL?.({ size: 256 }) ?? emoji.url ?? null,
    })),
    stickers: [...stickers.values()].map(sticker => ({
      id: sticker.id,
      name: sticker.name,
      description: sticker.description ?? null,
      tags: sticker.tags ?? null,
      format: sticker.format,
      available: sticker.available ?? null,
      url: sticker.url,
    })),
    soundboardSounds: [...soundboardSounds.values()].map(sound => ({
      id: sound.soundId ?? sound.id,
      name: sound.name,
      volume: sound.volume,
      emojiId: sound.emoji?.id ?? null,
      emojiName: sound.emoji?.name ?? null,
      available: sound.available ?? null,
      url: sound.url,
    })),
    autoModerationRules: [...autoModerationRules.values()].map(rule => ({
      id: rule.id,
      name: rule.name,
      creatorId: rule.creatorId,
      eventType: rule.eventType,
      triggerType: rule.triggerType,
      triggerMetadata: backupJsonSafe(rule.triggerMetadata ?? {}),
      actions: rule.actions.map(action => ({
        type: action.type,
        metadata: action.metadata
          ? backupJsonSafe(action.metadata)
          : null,
      })),
      enabled: Boolean(rule.enabled),
      exemptRoles: [...rule.exemptRoles.keys()],
      exemptChannels: [...rule.exemptChannels.keys()],
    })),
    scheduledEvents: [...scheduledEvents.values()].map(event => ({
      id: event.id,
      channelId: event.channelId,
      name: event.name,
      description: event.description ?? null,
      scheduledStartTimestamp: event.scheduledStartTimestamp,
      scheduledEndTimestamp: event.scheduledEndTimestamp,
      privacyLevel: event.privacyLevel,
      status: event.status,
      entityType: event.entityType,
      entityMetadata: event.entityMetadata
        ? backupJsonSafe(event.entityMetadata)
        : null,
      recurrenceRule: event.recurrenceRule
        ? backupJsonSafe(event.recurrenceRule)
        : null,
      imageURL: event.coverImageURL?.({ size: 1024 }) ?? null,
    })),
    bans: [...bans.values()].map(ban => ({
      user: {
        id: ban.user.id,
        username: ban.user.username,
        tag: ban.user.tag ?? null,
      },
      reason: ban.reason ?? null,
    })),
    webhooks: [...webhooks.values()].map(webhook => ({
      id: webhook.id,
      type: webhook.type,
      name: webhook.name,
      channelId: webhook.channelId,
      applicationId: webhook.applicationId ?? null,
      ownerId: webhook.owner?.id ?? null,
      avatarURL: webhook.avatarURL?.({ size: 256 }) ?? null,
    })),
    integrations: [...integrations.values()].map(integration => ({
      id: integration.id,
      name: integration.name,
      type: integration.type,
      enabled: integration.enabled,
      roleId: integration.role?.id ?? null,
      application: integration.application
        ? {
            id: integration.application.id,
            name: integration.application.name,
            botId: integration.application.bot?.id ?? null,
          }
        : null,
    })),
    invites: [...invites.values()].map(invite => ({
      code: invite.code,
      channelId: invite.channelId,
      inviterId: invite.inviterId ?? null,
      maxAge: invite.maxAge,
      maxUses: invite.maxUses,
      temporary: invite.temporary,
      uses: invite.uses ?? null,
      createdTimestamp: invite.createdTimestamp ?? null,
      expiresTimestamp: invite.expiresTimestamp ?? null,
    })),
    commands: [...commands.values()].map(command => ({
      id: command.id,
      applicationId: command.applicationId,
      name: command.name,
      description: command.description,
      type: command.type,
      defaultMemberPermissions:
        command.defaultMemberPermissions?.bitfield?.toString?.() ?? null,
      options: backupJsonSafe(command.options ?? []),
    })),
    messages: messageArchive,
    botData: captureBackupBotData(guild.id),
    limitations: {
      messages:
        'Volledig tekstarchief; kan niet met originele auteur, datum of ID worden teruggeplaatst.',
      bots:
        'Inventaris; andere bots vereisen opnieuw handmatige OAuth2-toestemming.',
      commands:
        'Inventaris van de eigen applicatie; commands van andere apps zijn niet toegankelijk.',
      attachments:
        'Metadata en Discord-links zijn opgeslagen; binaire bestanden zijn niet ingebed.',
      integrations:
        'Inventaris; externe accounts en geheime tokens zijn niet exporteerbaar.',
    },
    warnings,
  };

  backup.stats = {
    roles: backup.roles.length,
    channels: backup.channels.length,
    threads: backup.threads.length,
    members: backup.members.length,
    bots: backup.bots.length,
    messages: totalMessages,
    emojis: backup.emojis.length,
    stickers: backup.stickers.length,
    soundboardSounds: backup.soundboardSounds.length,
    autoModerationRules: backup.autoModerationRules.length,
    scheduledEvents: backup.scheduledEvents.length,
    bans: backup.bans.length,
    webhooks: backup.webhooks.length,
    integrations: backup.integrations.length,
    invites: backup.invites.length,
    commands: backup.commands.length,
    warnings: warnings.length,
  };

  return backup;
}

function makeServerBackupFilename(guildId, prefix = 'robinbackup') {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  return `${prefix}-${guildId}-${timestamp}.json.gz`;
}

async function persistRobinServerBackup(
  backup,
  prefix = 'robinbackup',
) {
  await mkdir(SERVER_BACKUP_DIRECTORY, { recursive: true });
  const jsonBuffer = Buffer.from(
    JSON.stringify(backup, null, 2),
    'utf8',
  );
  const compressed = await gzipAsync(jsonBuffer, { level: 9 });
  const filename = makeServerBackupFilename(
    backup.sourceGuildId,
    prefix,
  );
  const path = join(SERVER_BACKUP_DIRECTORY, filename);

  await writeFile(path, compressed, { flag: 'wx' });

  return {
    filename,
    path,
    compressedBytes: compressed.length,
    uncompressedBytes: jsonBuffer.length,
    sha256: createHash('sha256')
      .update(compressed)
      .digest('hex'),
  };
}

async function latestRobinBackupFilename(guildId) {
  await mkdir(SERVER_BACKUP_DIRECTORY, { recursive: true });
  const prefix = `robinbackup-${guildId}-`;
  const files = (await readdir(SERVER_BACKUP_DIRECTORY))
    .filter(name =>
      name.startsWith(prefix) && name.endsWith('.json.gz'),
    )
    .sort()
    .reverse();

  return files[0] ?? null;
}

function validateRobinBackupFilename(filename) {
  const safeName = String(filename ?? '').trim();

  if (
    !safeName ||
    safeName !== basename(safeName) ||
    !/^[a-zA-Z0-9._-]+\.json(?:\.gz)?$/.test(safeName)
  ) {
    throw new Error('Ongeldige backup_naam.');
  }

  return safeName;
}

async function readRobinBackupAttachment(attachment) {
  if (
    !attachment?.url ||
    !Number.isFinite(attachment.size) ||
    attachment.size > SERVER_BACKUP_MAX_INPUT_BYTES
  ) {
    throw new Error(
      'Het back-upbestand ontbreekt of is groter dan 100 MB.',
    );
  }

  const response = await fetch(attachment.url, {
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(
      `Downloaden van het back-upbestand mislukt (${response.status}).`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > SERVER_BACKUP_MAX_INPUT_BYTES) {
    throw new Error('Het gedownloade back-upbestand is te groot.');
  }

  return buffer;
}

async function parseRobinBackupBuffer(buffer) {
  const isGzip = buffer[0] === 0x1F && buffer[1] === 0x8B;
  const jsonBuffer = isGzip
    ? await gunzipAsync(buffer, {
        maxOutputLength: SERVER_BACKUP_MAX_OUTPUT_BYTES,
      })
    : buffer;

  if (jsonBuffer.length > SERVER_BACKUP_MAX_OUTPUT_BYTES) {
    throw new Error('De uitgepakte back-up is groter dan 512 MB.');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonBuffer.toString('utf8'));
  } catch {
    throw new Error('Dit bestand bevat geen geldige JSON-back-up.');
  }

  if (
    !parsed ||
    parsed.format !== SERVER_BACKUP_FORMAT ||
    parsed.version !== SERVER_BACKUP_VERSION ||
    !parsed.guild?.id ||
    !Array.isArray(parsed.roles) ||
    !Array.isArray(parsed.channels)
  ) {
    throw new Error(
      'Dit is geen geldige Robin-serverback-up van deze botversie.',
    );
  }

  return parsed;
}

function createRobinRestoreReport(backup, emergencyBackup) {
  return {
    sourceCreatedAt: backup.createdAt,
    startedAt: new Date().toISOString(),
    emergencyBackup,
    restored: {
      guildSettings: 0,
      rolesUpdated: 0,
      rolesCreated: 0,
      channelsUpdated: 0,
      channelsCreated: 0,
      threadsCreated: 0,
      memberRolesAdded: 0,
      nicknamesUpdated: 0,
      emojisUpdated: 0,
      emojisCreated: 0,
      stickersUpdated: 0,
      stickersCreated: 0,
      soundboardUpdated: 0,
      soundboardCreated: 0,
      autoModerationUpdated: 0,
      autoModerationCreated: 0,
      scheduledEventsUpdated: 0,
      scheduledEventsCreated: 0,
      bansRestored: 0,
      webhooksCreated: 0,
      botDataSections: 0,
    },
    inventoryOnly: {
      messages: backup.stats?.messages ?? 0,
      bots: backup.bots?.length ?? 0,
      commands: backup.commands?.length ?? 0,
      integrations: backup.integrations?.length ?? 0,
      invites: backup.invites?.length ?? 0,
    },
    roleIdMap: {},
    channelIdMap: {},
    errors: [],
    warnings: [...(backup.warnings ?? [])],
  };
}

function addRobinRestoreError(report, section, item, error) {
  const message = error?.message ?? String(error);
  report.errors.push({
    section,
    item: String(item ?? 'onbekend'),
    message: shorten(message, 1000),
  });
}

function mappedBackupRoleIds(savedIds, roleIdMap, guild) {
  return [...new Set(
    (savedIds ?? [])
      .map(id => roleIdMap.get(id) ?? id)
      .filter(id =>
        id !== guild.id && guild.roles.cache.has(id),
      ),
  )];
}

function remapBackupOverwrites(
  overwrites,
  roleIdMap,
  guild,
) {
  return (overwrites ?? []).flatMap(overwrite => {
    const isRole = Number(overwrite.type) === 0;
    const mappedId = isRole
      ? roleIdMap.get(overwrite.id) ?? overwrite.id
      : overwrite.id;

    if (isRole && !guild.roles.cache.has(mappedId)) {
      return [];
    }

    return [{
      id: mappedId,
      type: Number(overwrite.type),
      allow: String(overwrite.allow ?? '0'),
      deny: String(overwrite.deny ?? '0'),
    }];
  });
}

const ROBIN_RESTORABLE_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildVoice,
  ChannelType.GuildCategory,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);

function makeRobinChannelRestoreOptions({
  saved,
  roleIdMap,
  channelIdMap,
  guild,
  creating,
}) {
  const parent = saved.parentId
    ? channelIdMap.get(saved.parentId) ?? saved.parentId
    : null;
  const options = {
    name: saved.name,
    parent,
    permissionOverwrites: remapBackupOverwrites(
      saved.permissionOverwrites,
      roleIdMap,
      guild,
    ),
    reason: 'Herstel via /robinonlybackupload',
  };

  if (creating) options.type = Number(saved.type);
  if (Number.isFinite(saved.position)) {
    options.position = saved.position;
  }

  const type = Number(saved.type);
  const textTypes = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
  ]);
  const voiceTypes = new Set([
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
  ]);
  const forumTypes = new Set([
    ChannelType.GuildForum,
    ChannelType.GuildMedia,
  ]);

  if (textTypes.has(type) || forumTypes.has(type)) {
    options.topic = saved.topic ?? null;
    options.nsfw = Boolean(saved.nsfw);
    options.rateLimitPerUser = Number(saved.rateLimitPerUser ?? 0);
    if (saved.defaultAutoArchiveDuration) {
      options.defaultAutoArchiveDuration =
        saved.defaultAutoArchiveDuration;
    }
  }

  if (voiceTypes.has(type)) {
    if (Number.isFinite(saved.bitrate)) {
      options.bitrate = saved.bitrate;
    }
    if (Number.isFinite(saved.userLimit)) {
      options.userLimit = saved.userLimit;
    }
    options.rtcRegion = saved.rtcRegion ?? null;
    if (saved.videoQualityMode !== null) {
      options.videoQualityMode = saved.videoQualityMode;
    }
  }

  if (forumTypes.has(type)) {
    if (Number.isFinite(saved.defaultThreadRateLimitPerUser)) {
      options.defaultThreadRateLimitPerUser =
        saved.defaultThreadRateLimitPerUser;
    }
    options.availableTags = (saved.availableTags ?? []).map(tag => ({
      name: tag.name,
      moderated: Boolean(tag.moderated),
      emoji:
        tag.emojiId || tag.emojiName
          ? {
              id: tag.emojiId ?? undefined,
              name: tag.emojiName ?? undefined,
            }
          : undefined,
    }));
    options.defaultReactionEmoji =
      saved.defaultReactionEmoji ?? null;
    options.defaultSortOrder = saved.defaultSortOrder ?? null;
    if (saved.defaultForumLayout !== null) {
      options.defaultForumLayout = saved.defaultForumLayout;
    }
  }

  return options;
}

async function restoreRobinRoles(guild, backup, report) {
  const roleIdMap = new Map([[backup.guild.id, guild.id]]);
  let currentRoles = await guild.roles.fetch();
  const usedRoleIds = new Set();
  const savedEveryone = backup.roles.find(
    role => role.id === backup.guild.id,
  );

  if (savedEveryone) {
    try {
      await guild.roles.everyone.edit({
        permissions: String(savedEveryone.permissions ?? '0'),
        reason: 'Herstel @everyone via Robin-back-up',
      });
      report.restored.rolesUpdated += 1;
    } catch (error) {
      addRobinRestoreError(
        report,
        'rollen',
        '@everyone',
        error,
      );
    }
  }

  const restorableRoles = backup.roles
    .filter(role =>
      role.id !== backup.guild.id && !role.managed,
    )
    .sort((first, second) => first.position - second.position);

  for (const saved of restorableRoles) {
    try {
      let role = currentRoles.get(saved.id);

      if (!role || role.managed || role.id === guild.id) {
        role = [...currentRoles.values()].find(candidate =>
          !candidate.managed &&
          candidate.id !== guild.id &&
          !usedRoleIds.has(candidate.id) &&
          candidate.name === saved.name,
        );
      }

      const roleData = {
        name: saved.name,
        color: Number(saved.color ?? 0),
        hoist: Boolean(saved.hoist),
        mentionable: Boolean(saved.mentionable),
        permissions: String(saved.permissions ?? '0'),
        reason: 'Herstel via /robinonlybackupload',
      };

      if (role) {
        role = await role.edit(roleData);
        report.restored.rolesUpdated += 1;
      } else {
        role = await guild.roles.create(roleData);
        currentRoles.set(role.id, role);
        report.restored.rolesCreated += 1;
      }

      usedRoleIds.add(role.id);
      roleIdMap.set(saved.id, role.id);
      report.roleIdMap[saved.id] = role.id;
    } catch (error) {
      addRobinRestoreError(report, 'rollen', saved.name, error);
    }
  }

  try {
    const positions = restorableRoles.flatMap(saved => {
      const mappedId = roleIdMap.get(saved.id);
      const role = mappedId ? currentRoles.get(mappedId) : null;
      return role
        ? [{ role, position: saved.position }]
        : [];
    });

    if (positions.length) {
      await guild.roles.setPositions(positions);
    }
  } catch (error) {
    addRobinRestoreError(
      report,
      'rollen',
      'rolvolgorde',
      error,
    );
  }

  return roleIdMap;
}

async function restoreRobinChannels(
  guild,
  backup,
  roleIdMap,
  report,
) {
  const channelIdMap = new Map();
  const fetchedChannels = await guild.channels.fetch();
  const currentChannels = new Map(
    [...fetchedChannels.entries()].filter(([, channel]) => channel),
  );
  const usedChannelIds = new Set();
  const categories = backup.channels
    .filter(channel =>
      Number(channel.type) === ChannelType.GuildCategory,
    )
    .sort((first, second) => first.position - second.position);
  const regularChannels = backup.channels
    .filter(channel =>
      Number(channel.type) !== ChannelType.GuildCategory,
    )
    .sort((first, second) => first.position - second.position);

  for (const saved of [...categories, ...regularChannels]) {
    const type = Number(saved.type);

    if (!ROBIN_RESTORABLE_CHANNEL_TYPES.has(type)) {
      report.warnings.push(
        `Kanaal ${saved.name} heeft niet-herstelbaar type ` +
        `${saved.typeName ?? type}.`,
      );
      continue;
    }

    try {
      let channel = currentChannels.get(saved.id);

      if (!channel || Number(channel.type) !== type) {
        const expectedParentId = saved.parentId
          ? channelIdMap.get(saved.parentId) ?? saved.parentId
          : null;
        channel = [...currentChannels.values()].find(candidate =>
          Number(candidate.type) === type &&
          candidate.name === saved.name &&
          !usedChannelIds.has(candidate.id) &&
          (
            type === ChannelType.GuildCategory ||
            (candidate.parentId ?? null) === expectedParentId
          ),
        );
      }

      const options = makeRobinChannelRestoreOptions({
        saved,
        roleIdMap,
        channelIdMap,
        guild,
        creating: !channel,
      });

      if (channel) {
        channel = await channel.edit(options);
        report.restored.channelsUpdated += 1;
      } else {
        channel = await guild.channels.create(options);
        currentChannels.set(channel.id, channel);
        report.restored.channelsCreated += 1;
      }

      usedChannelIds.add(channel.id);
      channelIdMap.set(saved.id, channel.id);
      report.channelIdMap[saved.id] = channel.id;
    } catch (error) {
      addRobinRestoreError(report, 'kanalen', saved.name, error);
    }
  }

  for (const saved of backup.threads ?? []) {
    try {
      const parentId = channelIdMap.get(saved.parentId) ?? saved.parentId;
      const parent =
        currentChannels.get(parentId) ??
        guild.channels.cache.get(parentId);

      if (!parent || typeof parent.threads?.create !== 'function') {
        report.warnings.push(
          `Thread ${saved.name} kon niet worden gemaakt: ` +
          'bovenliggend kanaal ontbreekt of ondersteunt geen threads.',
        );
        continue;
      }

      let thread =
        parent.threads.cache?.get(saved.id) ??
        [...(parent.threads.cache?.values?.() ?? [])].find(
          candidate => candidate.name === saved.name,
        );

      if (!thread) {
        if (
          [ChannelType.GuildForum, ChannelType.GuildMedia]
            .includes(parent.type)
        ) {
          report.warnings.push(
            `Forumthread ${saved.name} staat in het archief maar ` +
            'wordt niet leeg opnieuw aangemaakt.',
          );
          continue;
        }

        thread = await parent.threads.create({
          name: saved.name,
          type: Number(saved.type),
          autoArchiveDuration:
            saved.thread?.autoArchiveDuration ?? 1440,
          rateLimitPerUser: Number(saved.rateLimitPerUser ?? 0),
          invitable:
            saved.thread?.invitable === null
              ? undefined
              : saved.thread?.invitable,
          reason: 'Herstel via /robinonlybackupload',
        });
        report.restored.threadsCreated += 1;
      }

      channelIdMap.set(saved.id, thread.id);
      report.channelIdMap[saved.id] = thread.id;
    } catch (error) {
      addRobinRestoreError(report, 'threads', saved.name, error);
    }
  }

  try {
    const positions = backup.channels.flatMap(saved => {
      const mappedId = channelIdMap.get(saved.id);
      return mappedId && Number.isFinite(saved.position)
        ? [{ channel: mappedId, position: saved.position }]
        : [];
    });

    if (positions.length) {
      await guild.channels.setPositions(positions);
    }
  } catch (error) {
    addRobinRestoreError(
      report,
      'kanalen',
      'kanaalvolgorde',
      error,
    );
  }

  return channelIdMap;
}

async function restoreRobinMembers(
  guild,
  backup,
  roleIdMap,
  report,
) {
  const members = await guild.members.fetch().catch(() =>
    guild.members.cache,
  );

  for (const saved of backup.members ?? []) {
    const member = members.get(saved.id);
    if (!member) continue;

    try {
      const roleIds = mappedBackupRoleIds(
        saved.roles,
        roleIdMap,
        guild,
      ).filter(roleId => !member.roles.cache.has(roleId));

      if (roleIds.length) {
        await member.roles.add(
          roleIds,
          'Herstel via /robinonlybackupload',
        );
        report.restored.memberRolesAdded += roleIds.length;
      }
    } catch (error) {
      addRobinRestoreError(
        report,
        'ledenrollen',
        `${saved.username} (${saved.id})`,
        error,
      );
    }

    try {
      if (
        saved.nickname !== undefined &&
        saved.nickname !== member.nickname &&
        typeof member.setNickname === 'function'
      ) {
        await member.setNickname(
          saved.nickname,
          'Herstel via /robinonlybackupload',
        );
        report.restored.nicknamesUpdated += 1;
      }
    } catch (error) {
      addRobinRestoreError(
        report,
        'bijnamen',
        `${saved.username} (${saved.id})`,
        error,
      );
    }
  }
}

async function fetchRobinAssetBuffer(url, maximumBytes = 20 * 1024 * 1024) {
  if (!url) return null;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Bestand ophalen mislukt (${response.status}).`);
  }

  const declaredSize = Number(
    response.headers.get('content-length') ?? 0,
  );
  if (declaredSize > maximumBytes) {
    throw new Error('Bestand is te groot om veilig te herstellen.');
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maximumBytes) {
    throw new Error('Bestand is te groot om veilig te herstellen.');
  }

  return buffer;
}

async function restoreRobinGuildAssets(
  guild,
  backup,
  roleIdMap,
  report,
) {
  const currentEmojis = await guild.emojis.fetch().catch(() =>
    guild.emojis.cache,
  );

  for (const saved of backup.emojis ?? []) {
    if (saved.managed) continue;

    try {
      const roles = mappedBackupRoleIds(
        saved.roles,
        roleIdMap,
        guild,
      );
      let emoji =
        currentEmojis.get(saved.id) ??
        [...currentEmojis.values()].find(
          candidate => candidate.name === saved.name,
        );

      if (emoji) {
        emoji = await emoji.edit({
          name: saved.name,
          roles,
          reason: 'Herstel via /robinonlybackupload',
        });
        report.restored.emojisUpdated += 1;
      } else if (saved.url) {
        emoji = await guild.emojis.create({
          attachment: saved.url,
          name: saved.name,
          roles,
          reason: 'Herstel via /robinonlybackupload',
        });
        currentEmojis.set(emoji.id, emoji);
        report.restored.emojisCreated += 1;
      }
    } catch (error) {
      addRobinRestoreError(report, 'emoji’s', saved.name, error);
    }
  }

  const currentStickers = await guild.stickers.fetch().catch(() =>
    guild.stickers.cache,
  );

  for (const saved of backup.stickers ?? []) {
    try {
      let sticker =
        currentStickers.get(saved.id) ??
        [...currentStickers.values()].find(
          candidate => candidate.name === saved.name,
        );

      if (sticker) {
        sticker = await sticker.edit({
          name: saved.name,
          description: saved.description ?? null,
          tags: saved.tags || 'Hollow Kings',
          reason: 'Herstel via /robinonlybackupload',
        });
        report.restored.stickersUpdated += 1;
      } else if (saved.url) {
        const file = await fetchRobinAssetBuffer(saved.url);
        sticker = await guild.stickers.create({
          file: {
            attachment: file,
            name: `${saved.name}.png`,
          },
          name: saved.name,
          description: saved.description ?? null,
          tags: saved.tags || 'Hollow Kings',
          reason: 'Herstel via /robinonlybackupload',
        });
        currentStickers.set(sticker.id, sticker);
        report.restored.stickersCreated += 1;
      }
    } catch (error) {
      addRobinRestoreError(report, 'stickers', saved.name, error);
    }
  }

  const currentSounds = await guild.soundboardSounds
    .fetch()
    .catch(() => guild.soundboardSounds.cache);

  for (const saved of backup.soundboardSounds ?? []) {
    try {
      let sound =
        currentSounds.get(saved.id) ??
        [...currentSounds.values()].find(
          candidate => candidate.name === saved.name,
        );
      const soundData = {
        name: saved.name,
        volume: saved.volume ?? 1,
        emojiId: saved.emojiId ?? undefined,
        emojiName: saved.emojiId
          ? undefined
          : saved.emojiName ?? undefined,
        reason: 'Herstel via /robinonlybackupload',
      };

      if (sound) {
        sound = await sound.edit(soundData);
        report.restored.soundboardUpdated += 1;
      } else if (saved.url) {
        const file = await fetchRobinAssetBuffer(saved.url, 2_000_000);
        sound = await guild.soundboardSounds.create({
          ...soundData,
          file,
        });
        currentSounds.set(sound.soundId ?? sound.id, sound);
        report.restored.soundboardCreated += 1;
      }
    } catch (error) {
      addRobinRestoreError(report, 'soundboard', saved.name, error);
    }
  }
}

function remapRobinAutoModerationActions(actions, channelIdMap) {
  return (actions ?? []).map(action => {
    const savedMetadata = action.metadata ?? {};
    const mappedChannelId = savedMetadata.channelId
      ? channelIdMap.get(savedMetadata.channelId) ??
        savedMetadata.channelId
      : null;
    const metadata = {};

    if (Number.isFinite(savedMetadata.durationSeconds)) {
      metadata.durationSeconds = savedMetadata.durationSeconds;
    }
    if (savedMetadata.customMessage) {
      metadata.customMessage = savedMetadata.customMessage;
    }
    if (mappedChannelId) {
      metadata.channel = mappedChannelId;
    }

    return {
      type: action.type,
      ...(Object.keys(metadata).length ? { metadata } : {}),
    };
  });
}

async function restoreRobinAutoModeration(
  guild,
  backup,
  roleIdMap,
  channelIdMap,
  report,
) {
  const currentRules = await guild.autoModerationRules
    .fetch()
    .catch(() => guild.autoModerationRules.cache);

  for (const saved of backup.autoModerationRules ?? []) {
    try {
      let rule =
        currentRules.get(saved.id) ??
        [...currentRules.values()].find(
          candidate => candidate.name === saved.name,
        );
      const data = {
        name: saved.name,
        eventType: saved.eventType,
        triggerMetadata: saved.triggerMetadata ?? {},
        actions: remapRobinAutoModerationActions(
          saved.actions,
          channelIdMap,
        ),
        enabled: Boolean(saved.enabled),
        exemptRoles: mappedBackupRoleIds(
          saved.exemptRoles,
          roleIdMap,
          guild,
        ),
        exemptChannels: (saved.exemptChannels ?? [])
          .map(id => channelIdMap.get(id) ?? id)
          .filter(id => guild.channels.cache.has(id)),
        reason: 'Herstel via /robinonlybackupload',
      };

      if (rule && rule.triggerType === saved.triggerType) {
        rule = await rule.edit(data);
        report.restored.autoModerationUpdated += 1;
      } else {
        rule = await guild.autoModerationRules.create({
          ...data,
          triggerType: saved.triggerType,
        });
        currentRules.set(rule.id, rule);
        report.restored.autoModerationCreated += 1;
      }
    } catch (error) {
      addRobinRestoreError(report, 'automod', saved.name, error);
    }
  }
}

async function restoreRobinScheduledEvents(
  guild,
  backup,
  channelIdMap,
  report,
) {
  const currentEvents = await guild.scheduledEvents
    .fetch()
    .catch(() => guild.scheduledEvents.cache);

  for (const saved of backup.scheduledEvents ?? []) {
    if (saved.status !== 1) {
      report.warnings.push(
        `Evenement ${saved.name} is niet meer gepland en staat ` +
        'alleen in het archief.',
      );
      continue;
    }

    if (
      Number.isFinite(saved.scheduledEndTimestamp) &&
      saved.scheduledEndTimestamp < Date.now()
    ) {
      report.warnings.push(
        `Evenement ${saved.name} is al verlopen en is niet ` +
        'opnieuw aangemaakt.',
      );
      continue;
    }

    try {
      let event =
        currentEvents.get(saved.id) ??
        [...currentEvents.values()].find(candidate =>
          candidate.name === saved.name &&
          candidate.scheduledStartTimestamp ===
            saved.scheduledStartTimestamp,
        );
      const mappedChannelId = saved.channelId
        ? channelIdMap.get(saved.channelId) ?? saved.channelId
        : null;
      const data = {
        name: saved.name,
        scheduledStartTime: saved.scheduledStartTimestamp,
        scheduledEndTime:
          saved.scheduledEndTimestamp ?? undefined,
        privacyLevel: saved.privacyLevel,
        entityType: saved.entityType,
        description: saved.description ?? undefined,
        channel: mappedChannelId ?? undefined,
        entityMetadata: saved.entityMetadata ?? undefined,
        reason: 'Herstel via /robinonlybackupload',
      };

      if (saved.imageURL) {
        data.image = await fetchRobinAssetBuffer(
          saved.imageURL,
          10 * 1024 * 1024,
        ).catch(() => undefined);
      }

      if (event) {
        event = await event.edit(data);
        report.restored.scheduledEventsUpdated += 1;
      } else {
        event = await guild.scheduledEvents.create(data);
        currentEvents.set(event.id, event);
        report.restored.scheduledEventsCreated += 1;
      }
    } catch (error) {
      addRobinRestoreError(
        report,
        'Discord-evenementen',
        saved.name,
        error,
      );
    }
  }
}

async function restoreRobinBansAndWebhooks(
  guild,
  backup,
  channelIdMap,
  report,
) {
  const currentBans = await guild.bans.fetch().catch(() => new Map());

  for (const saved of backup.bans ?? []) {
    if (currentBans.has(saved.user?.id)) continue;

    try {
      await guild.bans.create(saved.user.id, {
        deleteMessageSeconds: 0,
        reason:
          saved.reason || 'Hersteld via /robinonlybackupload',
      });
      report.restored.bansRestored += 1;
    } catch (error) {
      addRobinRestoreError(
        report,
        'bans',
        saved.user?.id,
        error,
      );
    }
  }

  const currentWebhooks = await guild.fetchWebhooks().catch(() =>
    new Map(),
  );

  for (const saved of backup.webhooks ?? []) {
    if (
      Number(saved.type) !== 1 ||
      currentWebhooks.has(saved.id) ||
      saved.applicationId
    ) {
      continue;
    }

    const channelId = channelIdMap.get(saved.channelId) ?? saved.channelId;
    const channel = guild.channels.cache.get(channelId);

    if (!channel || typeof channel.createWebhook !== 'function') {
      continue;
    }

    const duplicate = [...currentWebhooks.values()].find(webhook =>
      webhook.channelId === channelId && webhook.name === saved.name,
    );
    if (duplicate) continue;

    try {
      const webhook = await channel.createWebhook({
        name: saved.name || 'Herstelde webhook',
        avatar: saved.avatarURL ?? undefined,
        reason: 'Herstel via /robinonlybackupload',
      });
      currentWebhooks.set(webhook.id, webhook);
      report.restored.webhooksCreated += 1;
    } catch (error) {
      addRobinRestoreError(
        report,
        'webhooks',
        saved.name,
        error,
      );
    }
  }
}

async function restoreRobinGuildSettings(
  guild,
  backup,
  channelIdMap,
  report,
) {
  const saved = backup.guild;
  const mappedChannel = id =>
    id ? channelIdMap.get(id) ?? id : null;
  const data = {
    name: saved.name,
    description: saved.description ?? null,
    verificationLevel: saved.verificationLevel,
    defaultMessageNotifications:
      saved.defaultMessageNotifications,
    explicitContentFilter: saved.explicitContentFilter,
    afkTimeout: saved.afkTimeout,
    afkChannel: mappedChannel(saved.afkChannelId),
    systemChannel: mappedChannel(saved.systemChannelId),
    systemChannelFlags:
      String(saved.systemChannelFlags ?? '0'),
    rulesChannel: mappedChannel(saved.rulesChannelId),
    publicUpdatesChannel:
      mappedChannel(saved.publicUpdatesChannelId),
    safetyAlertsChannel:
      mappedChannel(saved.safetyAlertsChannelId),
    preferredLocale: saved.preferredLocale ?? undefined,
    premiumProgressBarEnabled:
      Boolean(saved.premiumProgressBarEnabled),
    reason: 'Herstel via /robinonlybackupload',
  };

  for (const [property, url] of [
    ['icon', saved.iconURL],
    ['banner', saved.bannerURL],
    ['splash', saved.splashURL],
    ['discoverySplash', saved.discoverySplashURL],
  ]) {
    if (!url) continue;

    try {
      data[property] = await fetchRobinAssetBuffer(
        url,
        15 * 1024 * 1024,
      );
    } catch (error) {
      report.warnings.push(
        `${property} kon niet worden opgehaald: ${error.message}`,
      );
    }
  }

  try {
    await guild.edit(data);
    report.restored.guildSettings = 1;
  } catch (error) {
    addRobinRestoreError(
      report,
      'serverinstellingen',
      saved.name,
      error,
    );
  }
}

function replaceGuildRecords(target, guildId, saved, belongsToGuild) {
  for (const [key, record] of Object.entries(target)) {
    if (belongsToGuild(key, record)) delete target[key];
  }
  Object.assign(target, saved ?? {});
}

async function restoreRobinBotData(guild, backup, report) {
  const saved = backup.botData;
  if (!saved) return;
  const guildId = guild.id;

  if (pointsStoreReady && saved.points) {
    replaceGuildRecords(
      pointsData.messages,
      guildId,
      saved.points.messages,
      (_key, record) => record?.guildId === guildId,
    );
    pointsData.guildStartedAt ??= {};
    pointsData.guildStartedAt[guildId] =
      saved.points.guildStartedAt ?? Date.now();
    pointsData.manualPoints ??= {};
    pointsData.manualPoints[guildId] =
      saved.points.manualPoints ?? {};
    pointsData.achievements ??= {};
    pointsData.achievements[guildId] =
      saved.points.achievements ?? {};
    pointsData.dailyPoints ??= {};
    if (saved.points.dailyPoints) {
      pointsData.dailyPoints[guildId] =
        saved.points.dailyPoints;
    } else {
      delete pointsData.dailyPoints[guildId];
    }
    await queuePointsSave();
    report.restored.botDataSections += 1;
  } else if (saved.points) {
    report.warnings.push('Puntenopslag was niet actief tijdens herstel.');
  }

  if (absenceStoreReady) {
    replaceGuildRecords(
      absenceData.approved,
      guildId,
      saved.absences,
      (_key, record) => record?.guildId === guildId,
    );
    await queueAbsenceSave();
    report.restored.botDataSections += 1;
  }

  if (processingReminderStoreReady) {
    replaceGuildRecords(
      processingReminderData.pending,
      guildId,
      saved.processingReminders,
      (_key, record) => record?.guildId === guildId,
    );
    await queueProcessingReminderSave();
    report.restored.botDataSections += 1;
  }

  if (giveawayStoreReady) {
    replaceGuildRecords(
      giveawayData.active,
      guildId,
      saved.giveaways,
      (_key, record) => record?.guildId === guildId,
    );
    await queueGiveawaySave();
    report.restored.botDataSections += 1;
  }

  if (communityStoreReady && saved.community) {
    replaceGuildRecords(
      communityData.dashboards,
      guildId,
      saved.community.dashboards,
      (key, record) => key === guildId || record?.guildId === guildId,
    );
    replaceGuildRecords(
      communityData.events,
      guildId,
      saved.community.events,
      (_key, record) => record?.guildId === guildId,
    );
    replaceGuildRecords(
      communityData.cooldowns,
      guildId,
      saved.community.cooldowns,
      (key, record) => key === guildId || record?.guildId === guildId,
    );
    await queueCommunitySave();
    report.restored.botDataSections += 1;
  }
}

async function restoreRobinServerBackup({
  guild,
  backup,
  emergencyBackup,
  onProgress,
}) {
  const report = createRobinRestoreReport(
    backup,
    emergencyBackup,
  );

  await onProgress?.('Rollen en permissies herstellen…');
  const roleIdMap = await restoreRobinRoles(
    guild,
    backup,
    report,
  );

  await onProgress?.('Categorieën en kanalen herstellen…');
  const channelIdMap = await restoreRobinChannels(
    guild,
    backup,
    roleIdMap,
    report,
  );

  await onProgress?.('Serverinstellingen herstellen…');
  await restoreRobinGuildSettings(
    guild,
    backup,
    channelIdMap,
    report,
  );

  await onProgress?.('Ledenrollen en bijnamen herstellen…');
  await restoreRobinMembers(
    guild,
    backup,
    roleIdMap,
    report,
  );

  await onProgress?.('Emoji’s, stickers en soundboard herstellen…');
  await restoreRobinGuildAssets(
    guild,
    backup,
    roleIdMap,
    report,
  );

  await onProgress?.('AutoMod, evenementen, bans en webhooks herstellen…');
  await restoreRobinAutoModeration(
    guild,
    backup,
    roleIdMap,
    channelIdMap,
    report,
  );
  await restoreRobinScheduledEvents(
    guild,
    backup,
    channelIdMap,
    report,
  );
  await restoreRobinBansAndWebhooks(
    guild,
    backup,
    channelIdMap,
    report,
  );

  await onProgress?.('Interne botgegevens herstellen…');
  await restoreRobinBotData(guild, backup, report);

  report.finishedAt = new Date().toISOString();
  return report;
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Bot is online als ${readyClient.user.tag}`);

  try {
    await initializePointsStore();

    for (const guild of readyClient.guilds.cache.values()) {
      await backfillDailyPointsForGuild(guild).catch(error => {
        console.error(
          `Dagpunten voor ${guild.name} starten mislukt:`,
          error.message,
        );
      });
    }

    scheduleDailyPointsRollover(readyClient);
    await processExistingPointsAchievements(readyClient);
  } catch (error) {
    console.error('Puntenopslag kon niet starten:', error.message);
  }

  try {
    await initializeAbsenceStore();
    await processExpiredAbsences(readyClient);

    const absenceExpiryTimer = setInterval(() => {
      processExpiredAbsences(readyClient).catch(error => {
        console.error(
          'Automatische afwezigheidscontrole mislukt:',
          error.message,
        );
      });
    }, ABSENCE_EXPIRY_CHECK_INTERVAL_MS);

    absenceExpiryTimer.unref?.();
  } catch (error) {
    console.error(
      'Afwezigheidsopslag kon niet starten:',
      error.message,
    );
  }

  try {
    await initializeProcessingReminderStore();
    await processDueProcessingReminders(readyClient);

    const processingReminderTimer = setInterval(() => {
      processDueProcessingReminders(readyClient).catch(error => {
        console.error(
          'Automatische verwerkherinneringscontrole mislukt:',
          error.message,
        );
      });
    }, PROCESSING_REMINDER_CHECK_INTERVAL_MS);

    processingReminderTimer.unref?.();
  } catch (error) {
    console.error(
      'Verwerkherinneringsopslag kon niet starten:',
      error.message,
    );
  }

  try {
    await initializeGiveawayStore();
    await processDueGiveaways(readyClient);

    const giveawayTimer = setInterval(() => {
      processDueGiveaways(readyClient).catch(error => {
        console.error(
          'Automatische giveawaycontrole mislukt:',
          error.message,
        );
      });
    }, GIVEAWAY_CHECK_INTERVAL_MS);

    giveawayTimer.unref?.();
  } catch (error) {
    console.error(
      'Giveawayopslag kon niet starten:',
      error.message,
    );
  }

  try {
    await initializeCommunityStore();
    await processCommunityTasks(readyClient);

    for (
      const record of
      Object.values(communityData.cooldowns)
    ) {
      if (
        record?.status === 'active' &&
        record.guildId &&
        Number.isFinite(record.endAt)
      ) {
        scheduleCommunityCooldown(
          readyClient,
          record,
        );
      }
    }

    const communityTimer = setInterval(() => {
      processCommunityTasks(readyClient).catch(error => {
        console.error(
          'Automatische dashboard-/evenementencontrole mislukt:',
          error.message,
        );
      });
    }, COMMUNITY_CHECK_INTERVAL_MS);

    communityTimer.unref?.();
  } catch (error) {
    console.error(
      'Dashboard-/evenementenopslag kon niet starten:',
      error.message,
    );
  }

  try {
    const globalCommands =
      await readyClient.application.commands.fetch();
    const oldGlobalCommands =
      globalCommands.filter(command =>
        [
          'zeg',
          'ledenlijst',
          'profiel',
          'puntenlijst',
          'puntenvandaag',
          'puntenindienen',
          'punten',
          'puntenreset',
          'sollicitatietrue',
          'sollicitatiefalse',
          'plukopen',
          'plukdicht',
          'wapendealer',
          'afwezig',
          'aanvraag',
          'mededeling',
          'regel',
          'ontslag',
          'geefwarn',
          'warnweg',
          'giveaway',
          'giveawaywinnaar',
          'dashboard',
          'cooldown',
          'cancelcooldown',
          'evenement',
          'evenementannuleer',
          'robinbackup',
          'robinonlybackupload',
          'chatbotaan',
          'chatbotuit',
        ].includes(command.name),
      );

    for (const oldGlobalCommand of oldGlobalCommands.values()) {
      await readyClient.application.commands.delete(oldGlobalCommand.id);
    }
  } catch (error) {
    console.error(
      'Kon oude globale commando’s niet verwijderen:',
      error.message,
    );
  }

  let registeredGuilds = 0;

  for (const guild of readyClient.guilds.cache.values()) {
    try {
      if (typeof guild.commands.fetch === 'function') {
        const currentCommands = await guild.commands.fetch();
        const removedChatbotCommands = currentCommands.filter(
          command =>
            ['chatbotaan', 'chatbotuit'].includes(command.name),
        );

        for (
          const removedCommand of
          removedChatbotCommands.values()
        ) {
          await guild.commands.delete(removedCommand.id);
        }
      }

      await guild.commands.create(sayCommand.toJSON());
      await guild.commands.create(memberListCommand.toJSON());
      await guild.commands.create(memberProfileCommand.toJSON());
      await guild.commands.create(pointsListCommand.toJSON());
      await guild.commands.create(pointsTodayCommand.toJSON());
      await guild.commands.create(pointsSubmitCommand.toJSON());
      await guild.commands.create(pointsCommand.toJSON());
      await guild.commands.create(pointsResetCommand.toJSON());
      await guild.commands.create(applicationsOpenCommand.toJSON());
      await guild.commands.create(applicationsClosedCommand.toJSON());
      await guild.commands.create(plukOpenCommand.toJSON());
      await guild.commands.create(plukClosedCommand.toJSON());
      await guild.commands.create(weaponDealerCommand.toJSON());
      await guild.commands.create(absenceCommand.toJSON());
      await guild.commands.create(processingRequestCommand.toJSON());
      await guild.commands.create(announcementCommand.toJSON());
      await guild.commands.create(ruleCommand.toJSON());
      await guild.commands.create(dismissalCommand.toJSON());
      await guild.commands.create(giveWarnCommand.toJSON());
      await guild.commands.create(removeWarnCommand.toJSON());
      await guild.commands.create(giveawayCommand.toJSON());
      await guild.commands.create(giveawayWinnerCommand.toJSON());
      await guild.commands.create(dashboardCommand.toJSON());
      await guild.commands.create(cooldownCommand.toJSON());
      await guild.commands.create(cancelCooldownCommand.toJSON());
      await guild.commands.create(eventCommand.toJSON());
      await guild.commands.create(cancelEventCommand.toJSON());
      await guild.commands.create(robinBackupCommand.toJSON());
      await guild.commands.create(
        robinBackupRestoreCommand.toJSON(),
      );
      registeredGuilds += 1;
    } catch (error) {
      console.error(
        `Kon de commando’s niet registreren in ${guild.name}:`,
        error.message,
      );
    }
  }

  console.log(
    `/zeg, /ledenlijst, /profiel, /puntenlijst, ` +
    `/puntenvandaag, /puntenindienen, /punten, ` +
    `/puntenreset, ` +
    `/sollicitatietrue, /sollicitatiefalse, /plukopen, ` +
    `/plukdicht, /wapendealer, /afwezig, /aanvraag en ` +
    `/mededeling, /regel, /ontslag, /geefwarn, /warnweg, /giveaway, ` +
    `/giveawaywinnaar, /dashboard, ` +
    `/cooldown, /cancelcooldown, /evenement en ` +
    `/evenementannuleer, /robinbackup en ` +
    `/robinonlybackupload zijn ` +
    `geregistreerd in ` +
    `${registeredGuilds} server(s)`,
  );
});

function formatRobinBackupSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'onbekend';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createRobinProgressEditor(interaction) {
  let lastUpdateAt = 0;

  return async (message, force = false) => {
    const now = Date.now();
    if (!force && now - lastUpdateAt < 2500) return;
    lastUpdateAt = now;

    await interaction.editReply({
      content: `⏳ **Robin Server Backup**\n${message}`,
      embeds: [],
      components: [],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  };
}

// /robinbackup: uitsluitend leden met de vaste Robin-back-uprol.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'robinbackup' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (!memberCanUseRobinBackup(interaction.member)) {
    await interaction.reply({
      content:
        `Alleen leden met <@&${ROBIN_BACKUP_ROLE_ID}> mogen een ` +
        'volledige serverback-up maken.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (
    serverBackupLocks.has(interaction.guildId) ||
    serverRestoreLocks.has(interaction.guildId)
  ) {
    await interaction.reply({
      content:
        'Er wordt voor deze server al een back-up of herstel uitgevoerd.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  serverBackupLocks.add(interaction.guildId);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const updateProgress = createRobinProgressEditor(interaction);

  try {
    await updateProgress(
      'De server wordt geïnventariseerd. Dit kan bij veel berichten ' +
      'enkele minuten duren.',
      true,
    );
    const backup = await buildRobinServerBackup({
      guild: interaction.guild,
      createdBy: interaction.user,
      includeMessages: true,
      onProgress: updateProgress,
    });

    await updateProgress('Back-up comprimeren en veilig opslaan…', true);
    const saved = await persistRobinServerBackup(backup);
    const summary =
      `✅ **Robin-back-up voltooid**\n` +
      `**Backupnaam:** \`${saved.filename}\`\n` +
      `**Rollen:** ${backup.stats.roles}\n` +
      `**Kanalen:** ${backup.stats.channels} + ` +
      `${backup.stats.threads} threads\n` +
      `**Leden/Bots:** ${backup.stats.members}/` +
      `${backup.stats.bots}\n` +
      `**Berichten:** ${backup.stats.messages}\n` +
      `**Emoji’s/Stickers/Sounds:** ${backup.stats.emojis}/` +
      `${backup.stats.stickers}/${backup.stats.soundboardSounds}\n` +
      `**Bestand:** ${formatRobinBackupSize(saved.compressedBytes)}\n` +
      `**Controlecode:** \`${saved.sha256.slice(0, 16)}…\`\n\n` +
      'Bewaar het bestand privé. Zonder bestand kun je dezelfde ' +
      'back-up later ook met de bovenstaande backupnaam laden.';

    try {
      await interaction.editReply({
        content: summary,
        files: [{
          attachment: saved.path,
          name: saved.filename,
          description: 'Gecomprimeerde Robin-serverback-up',
        }],
        allowedMentions: { parse: [] },
      });
    } catch (uploadError) {
      await interaction.editReply({
        content:
          `${summary}\n\n⚠️ Discord kon het bestand niet meesturen ` +
          `(waarschijnlijk te groot). Het staat wel opgeslagen op ` +
          'het Railway-volume en kan met de backupnaam worden geladen.',
        files: [],
        allowedMentions: { parse: [] },
      });
      console.warn(
        'Robin-back-upbestand meesturen mislukt:',
        uploadError.message,
      );
    }

    const logEmbed = makeEmbed(
      'server',
      'Robin-serverback-up gemaakt',
    ).addFields(
      {
        name: 'Uitgevoerd door',
        value: formatUser(interaction.user),
      },
      { name: 'Backupnaam', value: saved.filename },
      {
        name: 'Omvang',
        value:
          `${formatRobinBackupSize(saved.compressedBytes)} ` +
          `(ongecomprimeerd ` +
          `${formatRobinBackupSize(saved.uncompressedBytes)})`,
      },
      {
        name: 'Inhoud',
        value:
          `${backup.stats.roles} rollen • ` +
          `${backup.stats.channels} kanalen • ` +
          `${backup.stats.messages} berichten • ` +
          `${backup.stats.members} leden`,
      },
      {
        name: 'Waarschuwingen',
        value: String(backup.stats.warnings),
      },
    );
    await sendLog(interaction.guild, 'server', logEmbed);
  } catch (error) {
    console.error('/robinbackup-fout:', error);
    await interaction.editReply({
      content:
        '❌ De serverback-up kon niet veilig worden voltooid. ' +
        `Fout: ${shorten(error.message, 1500)}`,
      files: [],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  } finally {
    serverBackupLocks.delete(interaction.guildId);
  }
});

// /robinonlybackupload: dezelfde vaste rol, zonder Administrator-bypass.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'robinonlybackupload' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (!memberCanUseRobinBackup(interaction.member)) {
    await interaction.reply({
      content:
        `Alleen leden met <@&${ROBIN_BACKUP_ROLE_ID}> mogen een ` +
        'serverback-up herstellen.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (
    interaction.options.getString('bevestiging', true) !==
    'ROBIN_HERSTEL'
  ) {
    await interaction.reply({
      content: 'Het herstel is niet bevestigd.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    serverRestoreLocks.has(interaction.guildId) ||
    serverBackupLocks.has(interaction.guildId)
  ) {
    await interaction.reply({
      content:
        'Er wordt voor deze server al een back-up of herstel uitgevoerd.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const attachment =
    interaction.options.getAttachment('bestand');
  const requestedBackupName =
    interaction.options.getString('backup_naam')?.trim();

  if (attachment && requestedBackupName) {
    await interaction.reply({
      content:
        'Gebruik óf een bestand óf een backup_naam, niet allebei.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  serverRestoreLocks.add(interaction.guildId);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const updateProgress = createRobinProgressEditor(interaction);

  try {
    await updateProgress('Back-upbestand veilig controleren…', true);
    let backupBuffer;
    let selectedBackupName;

    if (attachment) {
      backupBuffer = await readRobinBackupAttachment(attachment);
      selectedBackupName = attachment.name;
    } else {
      selectedBackupName = requestedBackupName
        ? validateRobinBackupFilename(requestedBackupName)
        : await latestRobinBackupFilename(interaction.guildId);

      if (!selectedBackupName) {
        throw new Error(
          'Er is geen opgeslagen back-up gevonden. Voeg een bestand toe ' +
          'of gebruik eerst /robinbackup.',
        );
      }

      backupBuffer = await readFile(
        join(SERVER_BACKUP_DIRECTORY, selectedBackupName),
      );
    }

    const backup = await parseRobinBackupBuffer(backupBuffer);

    if (
      backup.sourceGuildId !== interaction.guildId ||
      backup.guild.id !== interaction.guildId
    ) {
      throw new Error(
        'Deze back-up hoort bij een andere Discord-server en wordt ' +
        'daarom niet geladen.',
      );
    }

    await updateProgress(
      'Eerst wordt automatisch een noodback-up van de huidige ' +
      'structuur gemaakt…',
      true,
    );
    const emergency = await buildRobinServerBackup({
      guild: interaction.guild,
      createdBy: interaction.user,
      includeMessages: false,
      onProgress: updateProgress,
    });
    const emergencySaved = await persistRobinServerBackup(
      emergency,
      'pre-restore',
    );

    const report = await restoreRobinServerBackup({
      guild: interaction.guild,
      backup,
      emergencyBackup: {
        filename: emergencySaved.filename,
        sha256: emergencySaved.sha256,
      },
      onProgress: updateProgress,
    });
    const reportName =
      `robin-restore-report-${interaction.guildId}-${Date.now()}.json`;
    const reportBuffer = Buffer.from(
      JSON.stringify(report, null, 2),
      'utf8',
    );
    const restored = report.restored;
    const summary =
      `✅ **Robin-herstel voltooid**\n` +
      `**Bron:** \`${selectedBackupName}\`\n` +
      `**Noodback-up:** \`${emergencySaved.filename}\`\n\n` +
      `**Rollen:** ${restored.rolesUpdated} bijgewerkt, ` +
      `${restored.rolesCreated} gemaakt\n` +
      `**Kanalen:** ${restored.channelsUpdated} bijgewerkt, ` +
      `${restored.channelsCreated} gemaakt\n` +
      `**Ledenrollen toegevoegd:** ${restored.memberRolesAdded}\n` +
      `**Emoji’s/Stickers/Sounds gemaakt:** ` +
      `${restored.emojisCreated}/${restored.stickersCreated}/` +
      `${restored.soundboardCreated}\n` +
      `**AutoMod/Evenementen/Bans:** ` +
      `${restored.autoModerationCreated + restored.autoModerationUpdated}/` +
      `${restored.scheduledEventsCreated + restored.scheduledEventsUpdated}/` +
      `${restored.bansRestored}\n` +
      `**Fouten:** ${report.errors.length} • ` +
      `**Waarschuwingen:** ${report.warnings.length}\n\n` +
      `De ${report.inventoryOnly.messages} historische berichten, ` +
      `${report.inventoryOnly.bots} andere bots en externe commands ` +
      'blijven als inventaris in het back-upbestand; Discord staat ' +
      'niet toe die exact met oorspronkelijke eigenaar/ID te herstellen.';

    await interaction.editReply({
      content: summary,
      files: [{
        attachment: reportBuffer,
        name: reportName,
        description: 'Volledig herstelrapport en oude/nieuwe ID-koppelingen',
      }],
      allowedMentions: { parse: [] },
    });

    const logEmbed = makeEmbed(
      'server',
      'Robin-serverback-up hersteld',
    ).addFields(
      {
        name: 'Uitgevoerd door',
        value: formatUser(interaction.user),
      },
      { name: 'Bronback-up', value: shorten(selectedBackupName) },
      { name: 'Noodback-up', value: emergencySaved.filename },
      {
        name: 'Hersteld',
        value:
          `${restored.rolesUpdated + restored.rolesCreated} rollen • ` +
          `${restored.channelsUpdated + restored.channelsCreated} ` +
          `kanalen • ${restored.memberRolesAdded} ledenrollen`,
      },
      {
        name: 'Resultaat',
        value:
          `${report.errors.length} fout(en) • ` +
          `${report.warnings.length} waarschuwing(en)`,
      },
    );
    await sendLog(interaction.guild, 'server', logEmbed);
  } catch (error) {
    console.error('/robinonlybackupload-fout:', error);
    await interaction.editReply({
      content:
        '❌ De back-up is niet hersteld of het herstel kon niet veilig ' +
        `worden voltooid. Fout: ${shorten(error.message, 1500)}`,
      files: [],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  } finally {
    serverRestoreLocks.delete(interaction.guildId);
  }
});

// /cooldown: ieder ganglid kan één gezamenlijke timer starten.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'cooldown' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !memberCanUseCooldown(
      interaction.member,
      interaction.memberPermissions,
    )
  ) {
    await interaction.reply({
      content:
        'Alleen leden met een ingestelde Hollow Kings-gangrol mogen de ' +
        'overvalcooldown starten.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!communityStoreReady) {
    await interaction.reply({
      content:
        'De cooldownopslag is niet beschikbaar. Controleer de ' +
        'Railway-logs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  if (cooldownLocks.has(interaction.guildId)) {
    await interaction.editReply(
      'De cooldown wordt momenteel verwerkt. Probeer het over ' +
      'een paar seconden opnieuw.',
    );
    return;
  }

  cooldownLocks.add(interaction.guildId);

  try {
    const now = Date.now();
    const existingRecord =
      communityData.cooldowns[interaction.guildId];

    if (
      existingRecord?.status === 'active' &&
      Number.isFinite(existingRecord.endAt)
    ) {
      if (existingRecord.endAt > now) {
        const endTimestamp =
          Math.floor(existingRecord.endAt / 1000);
        const messageLink = existingRecord.messageUrl
          ? `\n[Open de zichtbare timer](` +
            `${existingRecord.messageUrl})`
          : '';

        await interaction.editReply(
          'Er loopt al een overvalcooldown.\n' +
          `De cooldown eindigt <t:${endTimestamp}:R>.` +
          messageLink,
        );
        return;
      }

      await interaction.editReply(
        'De vorige cooldown is zojuist afgelopen. De eindmelding ' +
        'wordt automatisch verwerkt; probeer het daarna opnieuw.',
      );
      return;
    }

    const targetChannelId =
      COOLDOWN_CHANNEL_ID || interaction.channelId;
    const targetChannel =
      await resolveCommunityChannel(
        interaction.guild,
        targetChannelId,
      );

    if (
      !targetChannel ||
      typeof targetChannel.send !== 'function' ||
      !hasCommunityChannelPermissions(
        interaction.guild,
        targetChannel,
      )
    ) {
      await interaction.editReply(
        'Ik kan niet schrijven in het ingestelde cooldownkanaal. ' +
        'Controleer `COOLDOWN_CHANNEL_ID` en mijn kanaalrechten.',
      );
      return;
    }

    const rolePing = await canPingCommunityRole(
      interaction.guild,
      targetChannel,
      COOLDOWN_END_ROLE_ID,
    );

    if (!rolePing.role) {
      await interaction.editReply(
        `De cooldown-eindrol met ID ${COOLDOWN_END_ROLE_ID} bestaat ` +
        'niet ' +
        'in deze server.',
      );
      return;
    }

    if (!rolePing.canPing) {
      await interaction.editReply(
        'Ik kan de cooldown-eindrol niet echt pingen. Maak de rol ' +
        'vermeldbaar of geef de bot in het cooldownkanaal de ' +
        'permissie Iedereen, @here en alle rollen vermelden.',
      );
      return;
    }

    const record = {
      guildId: interaction.guildId,
      channelId: targetChannel.id,
      roleId: COOLDOWN_END_ROLE_ID,
      status: 'active',
      startedBy: interaction.user.id,
      startedAt: now,
      endAt: now + COOLDOWN_DURATION_MS,
      messageId: null,
      messageUrl: null,
    };
    const cooldownMessage = await targetChannel.send({
      embeds: [buildActiveCooldownEmbed(record)],
      allowedMentions: { parse: [] },
    });

    record.messageId = cooldownMessage.id;
    record.messageUrl =
      cooldownMessage.url ??
      `https://discord.com/channels/${interaction.guildId}/` +
      `${targetChannel.id}/${cooldownMessage.id}`;
    communityData.cooldowns[interaction.guildId] = record;

    try {
      await queueCommunitySave();
    } catch (error) {
      delete communityData.cooldowns[interaction.guildId];
      await cooldownMessage.delete().catch(() => {});
      throw error;
    }

    scheduleCommunityCooldown(client, record);

    const endTimestamp = Math.floor(record.endAt / 1000);

    await interaction.editReply(
      `De overvalcooldown is gestart in ${targetChannel}.\n` +
      `De zichtbare timer eindigt <t:${endTimestamp}:R>.\n` +
      `[Open de timer](${record.messageUrl})`,
    );
  } catch (error) {
    console.error('/cooldown-fout:', error);
    await interaction.editReply(
      'De overvalcooldown kon niet veilig worden gestart. ' +
      'Controleer de Railway-logs en mijn kanaalrechten.',
    );
  } finally {
    cooldownLocks.delete(interaction.guildId);
  }
});

// /cancelcooldown: alleen beheer kan de actieve timer stoppen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'cancelcooldown' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content:
        'Je hebt de permissie Server beheren nodig om een ' +
        'cooldown te annuleren.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!communityStoreReady) {
    await interaction.reply({
      content:
        'De cooldownopslag is niet beschikbaar. Controleer de ' +
        'Railway-logs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  if (cooldownLocks.has(interaction.guildId)) {
    await interaction.editReply(
      'De cooldown wordt momenteel verwerkt. Probeer het over ' +
      'een paar seconden opnieuw.',
    );
    return;
  }

  cooldownLocks.add(interaction.guildId);

  try {
    const record =
      communityData.cooldowns[interaction.guildId];

    if (
      !record ||
      record.status !== 'active' ||
      !Number.isFinite(record.endAt)
    ) {
      await interaction.editReply(
        'Er loopt momenteel geen overvalcooldown.',
      );
      return;
    }

    const scheduledTimer =
      cooldownTimers.get(interaction.guildId);

    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      cooldownTimers.delete(interaction.guildId);
    }

    delete communityData.cooldowns[interaction.guildId];

    try {
      await queueCommunitySave();
    } catch (error) {
      communityData.cooldowns[interaction.guildId] = record;
      scheduleCommunityCooldown(client, record);
      throw error;
    }

    const cancelledAt = Date.now();
    const channel = await resolveCommunityChannel(
      interaction.guild,
      record.channelId,
    );
    let notificationUrl = null;

    if (channel && typeof channel.send === 'function') {
      const cancelledEmbed = buildCancelledCooldownEmbed(
        record,
        interaction.user.id,
        cancelledAt,
      );

      if (
        record.messageId &&
        typeof channel.messages?.fetch === 'function'
      ) {
        const startMessage = await channel.messages
          .fetch(record.messageId)
          .catch(() => null);

        if (startMessage) {
          await startMessage.edit({
            embeds: [cancelledEmbed],
            allowedMentions: { parse: [] },
          }).catch(() => {});
        }
      }

      const notification = await channel.send({
        embeds: [cancelledEmbed],
        allowedMentions: { parse: [] },
      }).catch(() => null);

      notificationUrl = notification?.url ?? null;
    }

    await interaction.editReply(
      'De overvalcooldown is geannuleerd. De automatische ' +
      'eindmelding en Hollow Kings-rolping zijn uitgeschakeld.' +
      (
        notificationUrl
          ? `\n[Open de annuleringsmelding](${notificationUrl})`
          : '\nIk kon alleen geen zichtbare annuleringsmelding ' +
            'in het cooldownkanaal plaatsen.'
      ),
    );
  } catch (error) {
    console.error('/cancelcooldown-fout:', error);
    await interaction.editReply(
      'De cooldown kon niet veilig worden geannuleerd. ' +
      'Controleer de Railway-logs.',
    );
  } finally {
    cooldownLocks.delete(interaction.guildId);
  }
});

// /dashboard: beheer plaatst één live dashboard per server.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'dashboard' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!communityStoreReady) {
    await interaction.reply({
      content:
        'De dashboardopslag is niet beschikbaar. Controleer de ' +
        'Railway-logs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const action =
    interaction.options.getString('actie') ?? 'plaatsen';
  const savedRecord =
    communityData.dashboards[interaction.guildId];

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  if (action === 'verwijderen') {
    if (!savedRecord) {
      await interaction.editReply(
        'Er staat momenteel geen live dashboard ingesteld.',
      );
      return;
    }

    const oldChannel = await resolveCommunityChannel(
      interaction.guild,
      savedRecord.channelId,
    );
    const oldMessage =
      oldChannel &&
      typeof oldChannel.messages?.fetch === 'function'
        ? await oldChannel.messages
            .fetch(savedRecord.messageId)
            .catch(() => null)
        : null;

    if (oldMessage) {
      await oldMessage.delete().catch(() => {});
    }

    await removeDashboardRecord(interaction.guildId);
    await interaction.editReply(
      'Het live Hollow Kings-dashboard is verwijderd.',
    );

    const logEmbed = makeEmbed(
      'server',
      'Live dashboard verwijderd',
    ).addFields({
      name: 'Uitgevoerd door',
      value: formatUser(interaction.user),
    });
    await sendLog(interaction.guild, 'server', logEmbed);
    return;
  }

  const targetChannel =
    interaction.options.getChannel('kanaal') ??
    interaction.channel;

  if (
    !targetChannel ||
    typeof targetChannel.send !== 'function' ||
    !hasCommunityChannelPermissions(
      interaction.guild,
      targetChannel,
    )
  ) {
    await interaction.editReply(
      'Ik heb in dat kanaal Kanaal bekijken, Berichten verzenden ' +
      'en Links insluiten nodig.',
    );
    return;
  }

  try {
    const updatedAt = Date.now();
    const embed = await buildDashboardEmbed(
      interaction.guild,
      updatedAt,
    );
    let dashboardMessage = null;

    if (
      savedRecord?.channelId === targetChannel.id &&
      typeof targetChannel.messages?.fetch === 'function'
    ) {
      dashboardMessage = await targetChannel.messages
        .fetch(savedRecord.messageId)
        .catch(() => null);
    }

    if (dashboardMessage) {
      await dashboardMessage.edit({
        embeds: [embed],
        components: [
          buildDashboardRow(interaction.guildId),
        ],
        allowedMentions: { parse: [] },
      });
    } else {
      dashboardMessage = await targetChannel.send({
        embeds: [embed],
        components: [
          buildDashboardRow(interaction.guildId),
        ],
        allowedMentions: { parse: [] },
      });
    }

    const previousRecord =
      communityData.dashboards[interaction.guildId];
    communityData.dashboards[interaction.guildId] = {
      guildId: interaction.guildId,
      channelId: targetChannel.id,
      messageId: dashboardMessage.id,
      createdAt:
        previousRecord?.createdAt ?? Date.now(),
      createdBy:
        previousRecord?.createdBy ??
        interaction.user.id,
      updatedAt,
      updatedBy: interaction.user.id,
    };

    try {
      await queueCommunitySave();
    } catch (error) {
      if (!savedRecord || !dashboardMessage?.id) {
        await dashboardMessage?.delete().catch(() => {});
      }
      throw error;
    }

    if (
      savedRecord &&
      (
        savedRecord.channelId !== targetChannel.id ||
        savedRecord.messageId !== dashboardMessage.id
      )
    ) {
      const oldChannel = await resolveCommunityChannel(
        interaction.guild,
        savedRecord.channelId,
      );
      const oldMessage =
        oldChannel &&
        typeof oldChannel.messages?.fetch === 'function'
          ? await oldChannel.messages
              .fetch(savedRecord.messageId)
              .catch(() => null)
          : null;
      await oldMessage?.delete().catch(() => {});
    }

    await interaction.editReply(
      `Het live dashboard staat in ${targetChannel}. ` +
      'Het wordt automatisch iedere vijf minuten bijgewerkt.',
    );

    const logEmbed = makeEmbed(
      'server',
      savedRecord
        ? 'Live dashboard vernieuwd'
        : 'Live dashboard geplaatst',
    ).addFields(
      {
        name: 'Uitgevoerd door',
        value: formatUser(interaction.user),
      },
      {
        name: 'Kanaal',
        value: `<#${targetChannel.id}>`,
      },
      {
        name: 'Dashboard',
        value: dashboardMessage.url,
      },
    );
    await sendLog(interaction.guild, 'server', logEmbed);
  } catch (error) {
    console.error('/dashboard-fout:', error);
    await interaction.editReply(
      'Het dashboard kon niet veilig worden geplaatst. Controleer ' +
      'de Railway-opslag en mijn kanaalrechten.',
    );
  }
});

// Beheer kan het live dashboard tussendoor handmatig vernieuwen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isButton() ||
    !interaction.customId.startsWith('dashboard:refresh:') ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content:
        'Alleen beheer kan het dashboard handmatig vernieuwen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildId =
    interaction.customId.slice(
      'dashboard:refresh:'.length,
    );

  if (
    guildId !== interaction.guildId ||
    communityData.dashboards[guildId]?.messageId !==
      interaction.message.id
  ) {
    await interaction.reply({
      content: 'Deze dashboardknop is niet meer geldig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  try {
    const result = await updateDashboardMessage(
      interaction.guild,
      { force: true },
    );

    await interaction.editReply(
      result.status === 'updated'
        ? 'Het dashboard is vernieuwd.'
        : 'Het dashboard kon niet worden vernieuwd.',
    );
  } catch (error) {
    console.error('Dashboardknop-fout:', error);
    await interaction.editReply(
      'Het dashboard kon niet worden vernieuwd.',
    );
  }
});

// /evenement opent direct één compleet formulier in het huidige kanaal.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'evenement' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!communityStoreReady) {
    await interaction.reply({
      content:
        'De evenementenopslag is niet beschikbaar. Controleer de ' +
        'Railway-logs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetChannel = interaction.channel;

  if (
    !targetChannel ||
    typeof targetChannel.send !== 'function' ||
    !hasCommunityChannelPermissions(
      interaction.guild,
      targetChannel,
    )
  ) {
    await interaction.reply({
      content:
        'Ik heb in dat kanaal Kanaal bekijken, Berichten verzenden ' +
        'en Links insluiten nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  cleanupEventDrafts();
  const draftId = randomUUID();
  eventDrafts.set(draftId, {
    id: draftId,
    guildId: interaction.guildId,
    channelId: targetChannel.id,
    createdBy: interaction.user.id,
    expiresAt:
      Date.now() + EVENT_DRAFT_DURATION_MS,
  });

  const modal = new ModalBuilder()
    .setCustomId(`event:create:${draftId}`)
    .setTitle('Hollow Kings Evenement plannen');
  const titleInput = new TextInputBuilder()
    .setCustomId('event_title')
    .setPlaceholder('Bijvoorbeeld: Gangmeeting')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(200);
  const dateTimeInput = new TextInputBuilder()
    .setCustomId('event_date_time')
    .setPlaceholder('Bijvoorbeeld: 31-12-2026 20:30')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(13)
    .setMaxLength(21);
  const locationInput = new TextInputBuilder()
    .setCustomId('event_location')
    .setPlaceholder('Bijvoorbeeld: Hollow Kings loods')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(200);
  const descriptionInput = new TextInputBuilder()
    .setCustomId('event_description')
    .setPlaceholder(
      'Wat gaan jullie doen en wat moeten leden meenemen?',
    )
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(3000);
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('event_role')
    .setPlaceholder('Kies de rol die gepingd moet worden')
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1);

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Naam van het evenement')
      .setTextInputComponent(titleInput),
    new LabelBuilder()
      .setLabel('Datum en tijd')
      .setDescription('Gebruik DD-MM-JJJJ UU:MM')
      .setTextInputComponent(dateTimeInput),
    new LabelBuilder()
      .setLabel('Locatie')
      .setTextInputComponent(locationInput),
    new LabelBuilder()
      .setLabel('Beschrijving')
      .setTextInputComponent(descriptionInput),
    new LabelBuilder()
      .setLabel('Welke rol moet een melding krijgen?')
      .setDescription('Deze rol wordt echt gepingd')
      .setRoleSelectMenuComponent(roleSelect),
  );

  await interaction.showModal(modal);
});

// Ingevuld evenement valideren, opslaan en publiceren.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isModalSubmit() ||
    !interaction.customId.startsWith('event:create:') ||
    !interaction.inGuild()
  ) {
    return;
  }

  const draftId =
    interaction.customId.slice('event:create:'.length);
  cleanupEventDrafts();
  const draft = eventDrafts.get(draftId);

  if (
    !draft ||
    draft.guildId !== interaction.guildId ||
    draft.createdBy !== interaction.user.id
  ) {
    await interaction.reply({
      content:
        'Dit evenementformulier is verlopen. Gebruik `/evenement` ' +
        'opnieuw.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren niet meer.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const title =
    interaction.fields
      .getTextInputValue('event_title')
      .trim();
  const dateTime =
    interaction.fields
      .getTextInputValue('event_date_time')
      .trim();
  const location =
    interaction.fields
      .getTextInputValue('event_location')
      .trim();
  const description =
    interaction.fields
      .getTextInputValue('event_description')
      .trim();
  const selectedRoles =
    interaction.fields.getSelectedRoles(
      'event_role',
      true,
    );
  const role = selectedRoles.first();
  const startAt = parseEventDateTime(dateTime);

  if (!startAt || !role) {
    await interaction.reply({
      content:
        'Kies een rol en gebruik een geldige datum en tijd, ' +
        'bijvoorbeeld `31-12-2026 20:30`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (startAt <= Date.now() + EVENT_MINIMUM_LEAD_MS) {
    await interaction.reply({
      content:
        'Het evenement moet minimaal vijf minuten in de toekomst ' +
        'beginnen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetChannel = await resolveCommunityChannel(
    interaction.guild,
    draft.channelId,
  );
  const pingCheck = targetChannel
    ? await canPingCommunityRole(
        interaction.guild,
        targetChannel,
        role.id,
      )
    : { role: null, canPing: false };

  if (
    !targetChannel ||
    typeof targetChannel.send !== 'function' ||
    !hasCommunityChannelPermissions(
      interaction.guild,
      targetChannel,
    ) ||
    !pingCheck.role ||
    !pingCheck.canPing
  ) {
    await interaction.reply({
      content:
        'Het gekozen kanaal of de gekozen rol is niet meer ' +
        'beschikbaar voor de bot.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  const eventId = randomUUID();
  const record = {
    id: eventId,
    guildId: interaction.guildId,
    channelId: targetChannel.id,
    messageId: null,
    status: 'active',
    title,
    description,
    location,
    startAt,
    roleId: role.id,
    createdAt: Date.now(),
    createdBy: interaction.user.id,
    createdByTag:
      interaction.user.tag ??
      interaction.user.username ??
      interaction.user.id,
    guildIconUrl:
      interaction.guild.iconURL?.({ size: 256 }) ?? null,
    responses: {
      attending: [],
      maybe: [],
      declined: [],
    },
  };

  try {
    const eventMessage = await targetChannel.send({
      content: `<@&${record.roleId}>`,
      embeds: [buildEventEmbed(record)],
      components: [buildEventResponseRow(record)],
      allowedMentions: {
        parse: [],
        roles: [record.roleId],
      },
    });

    record.messageId = eventMessage.id;
    communityData.events[eventId] = record;

    try {
      await queueCommunitySave();
    } catch (error) {
      delete communityData.events[eventId];
      await eventMessage.delete().catch(() => {});
      throw error;
    }

    eventDrafts.delete(draftId);
    await interaction.editReply(
      `Het evenement is geplaatst: ${eventMessage.url}`,
    );

    const logEmbed = makeEmbed(
      'events',
      'Evenement aangemaakt',
    ).addFields(
      {
        name: 'Evenement',
        value: shorten(record.title),
      },
      {
        name: 'Datum en tijd',
        value:
          `<t:${Math.floor(record.startAt / 1000)}:F>`,
      },
      {
        name: 'Locatie',
        value: shorten(record.location),
      },
      {
        name: 'Aangemaakt door',
        value: formatUser(interaction.user),
      },
      {
        name: 'Rolping',
        value: `<@&${record.roleId}>`,
      },
      {
        name: 'Evenementbericht',
        value: eventMessage.url,
      },
    );
    await sendLog(interaction.guild, 'events', logEmbed);
    updateDashboardMessage(
      interaction.guild,
      { force: true },
    ).catch(() => {});
  } catch (error) {
    console.error('Evenement publiceren mislukt:', error);
    await interaction.editReply(
      'Het evenement kon niet veilig worden geplaatst. Controleer ' +
      'de Railway-opslag en mijn kanaalrechten.',
    );
  }
});

// Leden kiezen Aanwezig, Misschien of Afwezig en kunnen hun keuze wijzigen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isButton() ||
    !interaction.customId.startsWith('event:') ||
    !interaction.inGuild()
  ) {
    return;
  }

  const [, responseType, eventId] =
    interaction.customId.split(':');

  if (
    !['attending', 'maybe', 'declined'].includes(
      responseType,
    )
  ) {
    return;
  }

  const record = communityData.events[eventId];

  if (
    !record ||
    record.guildId !== interaction.guildId ||
    record.messageId !== interaction.message.id ||
    record.status !== 'active'
  ) {
    await interaction.reply({
      content: 'Dit evenement is niet meer actief.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (record.startAt <= Date.now()) {
    await interaction.reply({
      content:
        'De begintijd is bereikt; aanmelden is niet meer mogelijk.',
      flags: MessageFlags.Ephemeral,
    });
    startCommunityEvent(interaction.guild, record)
      .catch(() => {});
    return;
  }

  if (eventLocks.has(eventId)) {
    await interaction.reply({
      content:
        'Er wordt net een aanmelding verwerkt. Probeer het opnieuw.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  eventLocks.add(eventId);
  const previousResponses = JSON.stringify(
    normalizeEventResponses(record),
  );

  try {
    const responses = normalizeEventResponses(record);
    const previousType = [
      'attending',
      'maybe',
      'declined',
    ].find(type =>
      responses[type].includes(interaction.user.id),
    );

    for (
      const type of
      ['attending', 'maybe', 'declined']
    ) {
      responses[type] = responses[type].filter(
        userId => userId !== interaction.user.id,
      );
    }

    const removedChoice = previousType === responseType;
    if (!removedChoice) {
      responses[responseType].push(interaction.user.id);
    }

    try {
      await queueCommunitySave();
    } catch (error) {
      record.responses = JSON.parse(previousResponses);
      throw error;
    }

    await interaction.deferUpdate();
    await interaction.message.edit({
      embeds: [buildEventEmbed(record)],
      components: [buildEventResponseRow(record)],
      allowedMentions: { parse: [] },
    });
    await interaction.followUp({
      content: removedChoice
        ? 'Je keuze is verwijderd.'
        : `Je staat nu op **${getEventResponseLabel(
            responseType,
          )}**.`,
      flags: MessageFlags.Ephemeral,
    });

    const logEmbed = makeEmbed(
      'events',
      'Evenementaanmelding bijgewerkt',
    ).addFields(
      {
        name: 'Lid',
        value: formatUser(interaction.user),
      },
      {
        name: 'Evenement',
        value: shorten(record.title),
      },
      {
        name: 'Vorige keuze',
        value: previousType
          ? getEventResponseLabel(previousType)
          : 'Geen keuze',
        inline: true,
      },
      {
        name: 'Nieuwe keuze',
        value: removedChoice
          ? 'Geen keuze'
          : getEventResponseLabel(responseType),
        inline: true,
      },
      {
        name: 'Evenementbericht',
        value:
          `https://discord.com/channels/${record.guildId}/` +
          `${record.channelId}/${record.messageId}`,
      },
    );
    await sendLog(
      interaction.guild,
      'events',
      logEmbed,
    );
  } catch (error) {
    console.error('Evenementaanmelding mislukt:', error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content:
          'Je keuze kon niet veilig worden opgeslagen. Probeer ' +
          'het opnieuw.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  } finally {
    eventLocks.delete(eventId);
  }
});

// /evenementannuleer opent zonder opties een formulier met actieve events.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'evenementannuleer' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const activeEvents =
    getActiveCommunityEvents(interaction.guildId)
      .slice(0, 25);

  if (!activeEvents.length) {
    await interaction.reply({
      content:
        'Er zijn momenteel geen actieve evenementen om te ' +
        'annuleren.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const eventSelect = new StringSelectMenuBuilder()
    .setCustomId('event_cancel_select')
    .setPlaceholder('Kies het evenement dat niet doorgaat')
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      activeEvents.map(record => ({
        label: shorten(record.title, 100),
        description: shorten(
          new Date(record.startAt).toLocaleString(
            'nl-NL',
            {
              timeZone: GIVEAWAY_TIME_ZONE,
              dateStyle: 'short',
              timeStyle: 'short',
            },
          ) + ` • ${record.location}`,
          100,
        ),
        value: record.id,
      })),
    );
  const modal = new ModalBuilder()
    .setCustomId('event:cancel')
    .setTitle('Hollow Kings Evenement annuleren')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Welk evenement wil je annuleren?')
        .setDescription(
          'De rol en aangemelde leden krijgen een melding',
        )
        .setStringSelectMenuComponent(eventSelect),
    );

  await interaction.showModal(modal);
});

// De gekozen annulering uitvoeren, melden en loggen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isModalSubmit() ||
    interaction.customId !== 'event:cancel' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren niet meer.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const eventId =
    interaction.fields.getStringSelectValues(
      'event_cancel_select',
    )[0];
  const record = communityData.events[eventId];

  if (
    !record ||
    record.guildId !== interaction.guildId ||
    record.status !== 'active'
  ) {
    await interaction.reply({
      content:
        'Dit evenement is inmiddels niet meer actief.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (eventLocks.has(record.id)) {
    await interaction.reply({
      content:
        'Dit evenement wordt al verwerkt. Probeer het opnieuw.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  eventLocks.add(record.id);
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  const previousRecord = JSON.stringify(record);

  try {
    record.status = 'cancelled';
    record.cancelledAt = Date.now();
    record.cancelledBy = interaction.user.id;

    try {
      await queueCommunitySave();
    } catch (error) {
      communityData.events[record.id] =
        JSON.parse(previousRecord);
      throw error;
    }

    await updateEventMessage(
      interaction.guild,
      record,
    ).catch(() => {});

    const channel = await resolveCommunityChannel(
      interaction.guild,
      record.channelId,
    );
    const pingCheck = channel
      ? await canPingCommunityRole(
          interaction.guild,
          channel,
          record.roleId,
        )
      : { canPing: false };
    const userIds = getEventParticipantUserIds(record);

    if (channel && typeof channel.send === 'function') {
      const roleContent = pingCheck.canPing
        ? `<@&${record.roleId}>`
        : '';
      const userContent = userIds
        .map(userId => `<@${userId}>`)
        .join(' ');

      await channel.send({
        content:
          [roleContent, userContent]
            .filter(Boolean)
            .join(' ') ||
          '❌ Evenement geannuleerd',
        embeds: [
          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('❌ Evenement geannuleerd')
            .setDescription(
              `**${shorten(record.title, 1000)}** gaat niet door.`,
            )
            .setFooter({
              text:
                'Hollow Kings • Evenementenplanner',
            })
            .setTimestamp(),
        ],
        allowedMentions: {
          parse: [],
          roles: pingCheck.canPing
            ? [record.roleId]
            : [],
          users: userIds,
        },
      }).catch(() => {});
    }

    await interaction.editReply(
      `**${shorten(record.title, 500)}** is geannuleerd.`,
    );

    const logEmbed = makeEmbed(
      'events',
      'Evenement geannuleerd',
    ).addFields(
      {
        name: 'Evenement',
        value: shorten(record.title),
      },
      {
        name: 'Geannuleerd door',
        value: formatUser(interaction.user),
      },
      {
        name: 'Aangemeld / misschien',
        value: String(userIds.length),
      },
    );
    await sendLog(interaction.guild, 'events', logEmbed);
    updateDashboardMessage(
      interaction.guild,
      { force: true },
    ).catch(() => {});
  } catch (error) {
    console.error('/evenementannuleer-fout:', error);
    await interaction.editReply(
      'Het evenement kon niet veilig worden geannuleerd.',
    );
  } finally {
    eventLocks.delete(record.id);
  }
});

// /giveaway: eerste formulier met inhoud, winnaars en eindmoment.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'giveaway' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!giveawayStoreReady) {
    await interaction.reply({
      content:
        'De giveawayopslag is niet beschikbaar. Controleer de ' +
        'Railway-logs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId('giveaway:setup')
    .setTitle('Hollow Kings Giveaway • Stap 1 van 2');
  const prizeInput = new TextInputBuilder()
    .setCustomId('giveaway_prize')
    .setPlaceholder('Bijvoorbeeld: €1.000.000 en een voertuig')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(200);
  const winnerCountInput = new TextInputBuilder()
    .setCustomId('giveaway_winner_count')
    .setPlaceholder('Bijvoorbeeld: 2')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(2);
  const requirementsInput = new TextInputBuilder()
    .setCustomId('giveaway_requirements')
    .setPlaceholder(
      'Bijvoorbeeld: Klik op Meedoen en wees aanwezig bij de trekking',
    )
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(1500);
  const endDateInput = new TextInputBuilder()
    .setCustomId('giveaway_end_date')
    .setPlaceholder('DD-MM-JJJJ, bijvoorbeeld 31-12-2026')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(8)
    .setMaxLength(10);
  const endTimeInput = new TextInputBuilder()
    .setCustomId('giveaway_end_time')
    .setPlaceholder('UU:MM, bijvoorbeeld 20:30')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(5);

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Welke Giveaway')
      .setDescription('Wat kunnen de winnaars winnen?')
      .setTextInputComponent(prizeInput),
    new LabelBuilder()
      .setLabel('Hoeveel winnaars')
      .setDescription(
        `Kies een aantal van 1 t/m ${GIVEAWAY_MAX_WINNERS}`,
      )
      .setTextInputComponent(winnerCountInput),
    new LabelBuilder()
      .setLabel('Wat moet je doen om te winnen?')
      .setDescription('Omschrijf alle deelnamevoorwaarden')
      .setTextInputComponent(requirementsInput),
    new LabelBuilder()
      .setLabel('Einddatum')
      .setDescription('Nederlandse datum in DD-MM-JJJJ')
      .setTextInputComponent(endDateInput),
    new LabelBuilder()
      .setLabel('Eindtijd')
      .setDescription('Nederlandse tijd in UU:MM')
      .setTextInputComponent(endTimeInput),
  );

  await interaction.showModal(modal);
});

// Stap 1 valideren en een tijdelijke giveawaydraft bewaren.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isModalSubmit() ||
    interaction.customId !== 'giveaway:setup' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren niet meer.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const prize =
    interaction.fields
      .getTextInputValue('giveaway_prize')
      .trim();
  const winnerCountText =
    interaction.fields
      .getTextInputValue('giveaway_winner_count')
      .trim();
  const requirements =
    interaction.fields
      .getTextInputValue('giveaway_requirements')
      .trim();
  const endDate =
    interaction.fields
      .getTextInputValue('giveaway_end_date')
      .trim();
  const endTime =
    interaction.fields
      .getTextInputValue('giveaway_end_time')
      .trim();
  const winnerCount = Number.parseInt(
    winnerCountText,
    10,
  );
  const endAt =
    parseGiveawayEndDateTime(endDate, endTime);

  if (
    !/^\d{1,2}$/.test(winnerCountText) ||
    !Number.isInteger(winnerCount) ||
    winnerCount < 1 ||
    winnerCount > GIVEAWAY_MAX_WINNERS
  ) {
    await interaction.reply({
      content:
        `Het aantal winnaars moet tussen 1 en ` +
        `${GIVEAWAY_MAX_WINNERS} liggen.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!endAt) {
    await interaction.reply({
      content:
        'Gebruik een geldige einddatum en eindtijd, bijvoorbeeld ' +
        '`31-12-2026` en `20:30`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (endAt <= Date.now() + 60_000) {
    await interaction.reply({
      content:
        'De giveaway moet minimaal één minuut in de toekomst ' +
        'eindigen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  cleanupGiveawayDrafts();
  const draftId = randomUUID();
  giveawayDrafts.set(draftId, {
    id: draftId,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    createdBy: interaction.user.id,
    createdByTag:
      interaction.user.tag ??
      interaction.user.username ??
      interaction.user.id,
    prize,
    winnerCount,
    requirements,
    endAt,
    expiresAt:
      Date.now() + GIVEAWAY_DRAFT_DURATION_MS,
  });

  const continueButton = new ButtonBuilder()
    .setCustomId(`giveaway:media:${draftId}`)
    .setLabel('Rol en afbeeldingen kiezen')
    .setEmoji('🖼️')
    .setStyle(ButtonStyle.Primary);

  await interaction.reply({
    content:
      'Stap 1 is opgeslagen. Open nu stap 2 om de rol en ' +
      'maximaal drie afbeeldingen te kiezen.',
    components: [
      new ActionRowBuilder().addComponents(continueButton),
    ],
    flags: MessageFlags.Ephemeral,
  });
});

// Stap 2 openen met één rolkeuze en maximaal drie afbeeldingen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isButton() ||
    !interaction.customId.startsWith('giveaway:media:') ||
    !interaction.inGuild()
  ) {
    return;
  }

  const draftId =
    interaction.customId.slice('giveaway:media:'.length);
  cleanupGiveawayDrafts();
  const draft = giveawayDrafts.get(draftId);

  if (
    !draft ||
    draft.guildId !== interaction.guildId ||
    draft.channelId !== interaction.channelId ||
    draft.createdBy !== interaction.user.id
  ) {
    await interaction.reply({
      content:
        'Dit giveawayformulier is verlopen of hoort niet bij jou. ' +
        'Gebruik `/giveaway` opnieuw.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren niet meer.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('giveaway_role')
    .setPlaceholder('Kies de rol die gepingd moet worden')
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1);
  const fileUpload = new FileUploadBuilder()
    .setCustomId('giveaway_files')
    .setRequired(false)
    .setMinValues(0)
    .setMaxValues(3);
  const modal = new ModalBuilder()
    .setCustomId(`giveaway:publish:${draftId}`)
    .setTitle('Hollow Kings Giveaway • Stap 2 van 2')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Rollen Tagg <@&>')
        .setDescription(
          'Deze rol krijgt een echte Discord-melding',
        )
        .setRoleSelectMenuComponent(roleSelect),
      new LabelBuilder()
        .setLabel('Giveawayfoto’s')
        .setDescription(
          'Optioneel: upload maximaal drie afbeeldingen',
        )
        .setFileUploadComponent(fileUpload),
    );

  await interaction.showModal(modal);
});

// Stap 2 publiceren als complete giveaway met deelnameknop.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isModalSubmit() ||
    !interaction.customId.startsWith('giveaway:publish:') ||
    !interaction.inGuild()
  ) {
    return;
  }

  const draftId =
    interaction.customId.slice('giveaway:publish:'.length);
  cleanupGiveawayDrafts();
  const draft = giveawayDrafts.get(draftId);

  if (
    !draft ||
    draft.guildId !== interaction.guildId ||
    draft.channelId !== interaction.channelId ||
    draft.createdBy !== interaction.user.id
  ) {
    await interaction.reply({
      content:
        'Deze giveawaydraft is verlopen. Gebruik `/giveaway` ' +
        'opnieuw.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren niet meer.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedRoles =
    interaction.fields.getSelectedRoles(
      'giveaway_role',
      true,
    );
  const role = selectedRoles.first();
  const uploadedFiles =
    interaction.fields.getUploadedFiles(
      'giveaway_files',
      false,
    );
  const attachments = [
    ...(uploadedFiles?.values() ?? []),
  ];

  if (!role) {
    await interaction.reply({
      content: 'Kies een geldige rol voor de giveaway.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    attachments.length > 3 ||
    attachments.some(
      attachment =>
        !isGiveawayImageAttachment(attachment),
    )
  ) {
    await interaction.reply({
      content:
        'Upload bij Giveawayfoto’s maximaal drie geldige ' +
        'afbeeldingen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.channel;
  const botMember = interaction.guild.members.me;
  const botPermissions =
    botMember &&
    typeof channel?.permissionsFor === 'function'
      ? channel.permissionsFor(botMember)
      : null;

  if (
    !role.mentionable &&
    !botPermissions?.has(
      PermissionFlagsBits.MentionEveryone,
    )
  ) {
    await interaction.reply({
      content:
        'Ik kan deze rol niet echt pingen. Maak de rol vermeldbaar ' +
        'of geef mij in dit kanaal de permissie Alle rollen ' +
        'vermelden.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const giveawayId = randomUUID();
  const imageNames = attachments.map(
    (attachment, index) =>
      makeGiveawayImageName(
        giveawayId,
        attachment,
        index,
      ),
  );
  const record = {
    id: giveawayId,
    status: 'active',
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    messageId: null,
    createdBy: draft.createdBy,
    createdByTag: draft.createdByTag,
    createdAt: Date.now(),
    prize: draft.prize,
    winnerCount: draft.winnerCount,
    requirements: draft.requirements,
    endAt: draft.endAt,
    roleId: role.id,
    participantIds: [],
    imageNames,
    guildIconUrl:
      interaction.guild.iconURL?.({ size: 256 }) ?? null,
  };
  const files = attachments.map(
    (attachment, index) => ({
      attachment: attachment.url,
      name: imageNames[index],
      description: attachment.description,
    }),
  );

  try {
    await interaction.reply({
      content: `<@&${role.id}>`,
      embeds: buildGiveawayEmbeds(record),
      components: [buildGiveawayJoinRow(record)],
      files,
      allowedMentions: {
        parse: [],
        roles: [role.id],
      },
    });

    const giveawayMessage =
      await interaction.fetchReply();
    record.messageId = giveawayMessage.id;
    giveawayData.active[giveawayId] = record;

    try {
      await queueGiveawaySave();
    } catch (error) {
      delete giveawayData.active[giveawayId];
      await giveawayMessage.delete().catch(() => {});
      throw error;
    }

    giveawayDrafts.delete(draftId);

    const logEmbed = makeEmbed(
      'giveaway',
      'Giveaway aangemaakt',
    ).addFields(
      {
        name: 'Giveaway',
        value: shorten(record.prize),
      },
      {
        name: 'Winnaars',
        value: String(record.winnerCount),
        inline: true,
      },
      {
        name: 'Eindigt',
        value:
          `<t:${Math.floor(record.endAt / 1000)}:F>\n` +
          `<t:${Math.floor(record.endAt / 1000)}:R>`,
        inline: true,
      },
      {
        name: 'Rolping',
        value: `<@&${record.roleId}>`,
      },
      {
        name: 'Aangemaakt door',
        value: formatUser(interaction.user),
      },
      {
        name: 'Giveawaybericht',
        value: giveawayMessage.url,
      },
    );

    await sendLog(
      interaction.guild,
      'giveaway',
      logEmbed,
    );
  } catch (error) {
    console.error('Giveaway publiceren mislukt:', error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content:
          'Ik kon de giveaway niet publiceren. Controleer mijn ' +
          'rechten voor berichten, embeds, bestanden en rolmentions.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  }
});

// Leden kunnen zichzelf één keer inschrijven via de Meedoen-knop.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isButton() ||
    !interaction.customId.startsWith('giveaway:join:') ||
    !interaction.inGuild()
  ) {
    return;
  }

  const giveawayId =
    interaction.customId.slice('giveaway:join:'.length);
  const record = giveawayData.active[giveawayId];

  if (
    !record ||
    record.guildId !== interaction.guildId ||
    record.messageId !== interaction.message.id
  ) {
    await interaction.reply({
      content: 'Deze giveaway is niet meer actief.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (record.status !== 'active' || record.endAt <= Date.now()) {
    await interaction.reply({
      content:
        'De eindtijd is bereikt; de winnaar(s) worden nu gekozen.',
      flags: MessageFlags.Ephemeral,
    });

    finishGiveaway({
      guild: interaction.guild,
      giveawayId,
    }).catch(error => {
      console.error(
        'Giveaway na late deelname beëindigen mislukt:',
        error.message,
      );
    });
    return;
  }

  if (record.participantIds.includes(interaction.user.id)) {
    await interaction.reply({
      content:
        `Je doet al mee met **${shorten(record.prize, 500)}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (giveawayLocks.has(giveawayId)) {
    await interaction.reply({
      content:
        'Er wordt net een deelname verwerkt. Probeer het opnieuw.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  giveawayLocks.add(giveawayId);

  try {
    record.participantIds.push(interaction.user.id);

    try {
      await queueGiveawaySave();
    } catch (error) {
      record.participantIds =
        record.participantIds.filter(
          userId => userId !== interaction.user.id,
        );
      throw error;
    }

    await interaction.deferUpdate();
    await interaction.message.edit({
      embeds: buildGiveawayEmbeds(record),
      components: [buildGiveawayJoinRow(record)],
      allowedMentions: { parse: [] },
    });
    await interaction.followUp({
      content:
        `🎉 Je doet mee met **${shorten(record.prize, 500)}**!`,
      flags: MessageFlags.Ephemeral,
    });

    const logEmbed = makeEmbed(
      'giveaway',
      'Nieuwe giveawaydeelname',
    ).addFields(
      {
        name: 'Deelnemer',
        value: formatUser(interaction.user),
      },
      {
        name: 'Giveaway',
        value: shorten(record.prize),
      },
      {
        name: 'Aantal deelnemers',
        value: String(record.participantIds.length),
      },
      {
        name: 'Giveawaybericht',
        value:
          `https://discord.com/channels/${record.guildId}/` +
          `${record.channelId}/${record.messageId}`,
      },
    );

    await sendLog(
      interaction.guild,
      'giveaway',
      logEmbed,
    );
  } catch (error) {
    console.error('Giveawaydeelname mislukt:', error.message);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content:
          'Je deelname kon niet veilig worden opgeslagen. Probeer ' +
          'het opnieuw.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  } finally {
    giveawayLocks.delete(giveawayId);
  }
});

// /giveawaywinnaar: actieve giveaway en deelnemende winnaars kiezen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'giveawaywinnaar' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const activeGiveaways = Object.values(
    giveawayData.active,
  )
    .filter(
      record =>
        record.guildId === interaction.guildId &&
        record.status === 'active' &&
        record.participantIds?.length,
    )
    .sort((recordA, recordB) =>
      recordA.endAt - recordB.endAt,
    )
    .slice(0, 25);

  if (!activeGiveaways.length) {
    await interaction.reply({
      content:
        'Er is geen actieve giveaway met deelnemers om handmatig ' +
        'af te ronden.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const giveawaySelect = new StringSelectMenuBuilder()
    .setCustomId('giveaway_manual_select')
    .setPlaceholder('Kies de actieve giveaway')
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      activeGiveaways.map(record => ({
        label: shorten(record.prize, 100),
        description:
          `${record.participantIds.length} deelnemers • ` +
          `${record.winnerCount} winnaar(s)`,
        value: record.id,
      })),
    );
  const winnerSelect = new UserSelectMenuBuilder()
    .setCustomId('giveaway_manual_users')
    .setPlaceholder('Kies één of meer deelnemers')
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(GIVEAWAY_MAX_WINNERS);
  const modal = new ModalBuilder()
    .setCustomId('giveaway:manual-winners')
    .setTitle('Giveawaywinnaar(s) kiezen')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Welke giveaway?')
        .setDescription('Kies één actieve giveaway')
        .setStringSelectMenuComponent(giveawaySelect),
      new LabelBuilder()
        .setLabel('Wie heeft gewonnen?')
        .setDescription(
          'Selecteer alleen leden die hebben meegedaan',
        )
        .setUserSelectMenuComponent(winnerSelect),
    );

  await interaction.showModal(modal);
});

// Handmatige winnaars valideren en de giveaway direct beëindigen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isModalSubmit() ||
    interaction.customId !== 'giveaway:manual-winners' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren niet meer.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const giveawayId =
    interaction.fields.getStringSelectValues(
      'giveaway_manual_select',
    )[0];
  const selectedUsers =
    interaction.fields.getSelectedUsers(
      'giveaway_manual_users',
      true,
    );
  const winnerIds = [...selectedUsers.keys()];
  const record = giveawayData.active[giveawayId];

  if (
    !record ||
    record.guildId !== interaction.guildId ||
    record.status !== 'active'
  ) {
    await interaction.reply({
      content: 'Deze giveaway is inmiddels niet meer actief.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    winnerIds.length < 1 ||
    winnerIds.length > record.winnerCount
  ) {
    await interaction.reply({
      content:
        `Kies minimaal één en maximaal ${record.winnerCount} ` +
        'winnaar(s) voor deze giveaway.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const invalidWinnerIds = winnerIds.filter(
    userId => !record.participantIds.includes(userId),
  );

  if (invalidWinnerIds.length) {
    await interaction.reply({
      content:
        `Deze gekozen gebruiker(s) hebben niet meegedaan: ` +
        `${invalidWinnerIds
          .map(userId => `<@${userId}>`)
          .join(', ')}`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  try {
    const finished = await finishGiveaway({
      guild: interaction.guild,
      giveawayId,
      manualWinnerIds: winnerIds,
      endedBy: interaction.user.id,
    });

    await interaction.editReply({
      content:
        `Giveaway **${shorten(finished.prize, 500)}** is ` +
        `handmatig afgerond met ${winnerIds.length} winnaar(s).`,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error(
      'Handmatige giveawaywinnaar kiezen mislukt:',
      error,
    );
    await interaction.editReply(
      'De giveaway kon niet veilig worden afgerond. Controleer ' +
      'de Railway-logs.',
    );
  }
});

// /ontslag, /geefwarn en /warnweg: uitsluitend de vaste leidingrol.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    !['ontslag', 'geefwarn', 'warnweg'].includes(
      interaction.commandName,
    ) ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (!memberCanUseStaffActions(interaction)) {
    await interaction.reply({
      content:
        `Alleen leden met <@&${STAFF_ACTION_ROLE_ID}> mogen ` +
        'dit commando gebruiken.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const action = interaction.commandName;
  const modal = new ModalBuilder()
    .setCustomId(`staff-action:${action}`)
    .setTitle(
      action === 'ontslag'
        ? 'Hollow Kings • Ontslag'
        : action === 'geefwarn'
          ? 'Hollow Kings • Warn geven'
          : 'Hollow Kings • Warn verwijderen',
    );
  const targetSelect = new UserSelectMenuBuilder()
    .setCustomId('staff_action_target')
    .setPlaceholder('Kies één persoon')
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1);
  const components = [
    new LabelBuilder()
      .setLabel('Wie?')
      .setDescription('Kies het betreffende serverlid')
      .setUserSelectMenuComponent(targetSelect),
  ];

  if (action === 'ontslag' || action === 'geefwarn') {
    const reasonInput = new TextInputBuilder()
      .setCustomId('staff_action_reason')
      .setPlaceholder('Omschrijf de reden duidelijk en feitelijk')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(1000);
    components.push(
      new LabelBuilder()
        .setLabel('Reden')
        .setTextInputComponent(reasonInput),
    );
  }

  if (action === 'geefwarn' || action === 'warnweg') {
    const warnRoleSelect = new RoleSelectMenuBuilder()
      .setCustomId('staff_action_warn_role')
      .setPlaceholder('Kies de warnrol')
      .setRequired(true)
      .setMinValues(1)
      .setMaxValues(1);
    components.push(
      new LabelBuilder()
        .setLabel(
          action === 'geefwarn'
            ? 'Welke warn krijgt deze persoon?'
            : 'Welke warn moet worden verwijderd?',
        )
        .setDescription('Kies precies één warnrol')
        .setRoleSelectMenuComponent(warnRoleSelect),
    );
  }

  if (action === 'geefwarn') {
    const sanctionInput = new TextInputBuilder()
      .setCustomId('staff_action_sanction')
      .setPlaceholder('Omschrijf de opgelegde sanctie')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(1000);
    components.push(
      new LabelBuilder()
        .setLabel('Sanctie')
        .setTextInputComponent(sanctionInput),
    );
  }

  modal.addLabelComponents(...components);

  try {
    await interaction.showModal(modal);
  } catch (error) {
    console.error(
      `/${action}-formulier openen mislukt:`,
      error.message,
    );
  }
});

// De ingevulde personeelsactie uitvoeren, openbaar tonen en loggen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isModalSubmit() ||
    !interaction.customId.startsWith('staff-action:') ||
    !interaction.inGuild()
  ) {
    return;
  }

  const action = interaction.customId.slice(
    'staff-action:'.length,
  );

  if (!['ontslag', 'geefwarn', 'warnweg'].includes(action)) {
    return;
  }

  if (!memberCanUseStaffActions(interaction)) {
    await interaction.reply({
      content:
        `Alleen leden met <@&${STAFF_ACTION_ROLE_ID}> mogen ` +
        'deze actie afronden.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const selectedUsers = interaction.fields.getSelectedUsers(
    'staff_action_target',
    true,
  );
  const targetUser = selectedUsers.first();

  if (!targetUser || targetUser.bot) {
    await interaction.reply({
      content: 'Kies een geldig serverlid dat geen bot is.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'ontslag') {
    const reason = interaction.fields
      .getTextInputValue('staff_action_reason')
      .trim();

    if (!reason) {
      await interaction.reply({
        content: 'Vul een geldige reden voor het ontslag in.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetMember =
      interaction.guild.members.cache.get(targetUser.id) ??
      (await interaction.guild.members
        .fetch(targetUser.id)
        .catch(() => null));

    if (!targetMember) {
      await interaction.reply({
        content: 'Deze persoon is niet meer aanwezig in de server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const currentRoles = [...targetMember.roles.cache.values()];
    const dismissalRoles = currentRoles.filter(role =>
      role.id !== interaction.guild.id &&
      role.id !== DISMISSAL_PRESERVED_ROLE_ID,
    );
    const rolesToRemove = dismissalRoles.filter(
      role => !role.managed && role.editable === true,
    );
    const blockedRoles = dismissalRoles.filter(
      role => role.managed || role.editable !== true,
    );
    const preservedRoleWasPresent = targetMember.roles.cache.has(
      DISMISSAL_PRESERVED_ROLE_ID,
    );

    if (rolesToRemove.length) {
      try {
        await targetMember.roles.remove(
          rolesToRemove.map(role => role.id),
          `Ontslag uitgevoerd door ${interaction.user.id}`,
        );
      } catch (error) {
        console.error(
          'Rollen verwijderen bij ontslag mislukt:',
          error.message,
        );
        await interaction.reply({
          content:
            'Ik kon de verwijderbare rollen niet verwijderen. ' +
            'Controleer Rollen beheren en zet mijn botrol hoger. ' +
            'Er is geen ontslagmelding geplaatst.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('🚪 Ontslag • Hollow Kings')
      .addFields(
        {
          name: 'Persoon',
          value: `<@${targetUser.id}>`,
        },
        {
          name: 'Reden',
          value: shorten(reason, 1024),
        },
        {
          name: 'Rollen',
          value:
            `**${rolesToRemove.length} verwijderd**\n` +
            (preservedRoleWasPresent
              ? `<@&${DISMISSAL_PRESERVED_ROLE_ID}> behouden`
              : 'De uitzonderingsrol was niet aanwezig') +
            (blockedRoles.length
              ? `\n**${blockedRoles.length} technisch niet ` +
                'verwijderbaar**'
              : ''),
        },
      )
      .setFooter({
        text:
          `Uitgevoerd door ` +
          `${interaction.user.tag ?? interaction.user.username}`,
      })
      .setTimestamp();

    await interaction.reply({
      content: `<@${targetUser.id}>`,
      embeds: [embed],
      allowedMentions: {
        parse: [],
        users: [targetUser.id],
      },
    });

    const logEmbed = makeEmbed(
      'dismissals',
      'Ontslag vastgelegd',
    ).addFields(
      {
        name: 'Persoon',
        value: `<@${targetUser.id}> (${targetUser.id})`,
      },
      {
        name: 'Reden',
        value: shorten(reason, 1024),
      },
      {
        name: 'Verwijderde rollen',
        value: rolesToRemove.length
          ? shorten(
              rolesToRemove
                .map(role => `<@&${role.id}> (${role.id})`)
                .join('\n'),
              1024,
            )
          : 'Geen verwijderbare rollen aanwezig',
      },
      {
        name: 'Uitzonderingsrol',
        value: preservedRoleWasPresent
          ? `<@&${DISMISSAL_PRESERVED_ROLE_ID}> behouden`
          : 'Niet aanwezig bij het lid',
      },
      {
        name: 'Technisch niet verwijderbaar',
        value: blockedRoles.length
          ? shorten(
              blockedRoles
                .map(role => `<@&${role.id}> (${role.id})`)
                .join('\n'),
              1024,
            )
          : 'Geen',
      },
      {
        name: 'Uitgevoerd door',
        value: formatUser(interaction.user),
      },
      {
        name: 'Kanaal',
        value: `<#${interaction.channelId}>`,
      },
    );
    await sendLog(interaction.guild, 'dismissals', logEmbed);
    return;
  }

  const selectedRoles = interaction.fields.getSelectedRoles(
    'staff_action_warn_role',
    true,
  );
  const warnRole = selectedRoles.first();
  const roleError = getWarnRoleValidationError(
    interaction.guild,
    warnRole,
  );

  if (roleError) {
    await interaction.reply({
      content: roleError,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetMember =
    interaction.guild.members.cache.get(targetUser.id) ??
    (await interaction.guild.members
      .fetch(targetUser.id)
      .catch(() => null));

  if (!targetMember) {
    await interaction.reply({
      content: 'Deze persoon is niet meer aanwezig in de server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'geefwarn') {
    const reason = interaction.fields
      .getTextInputValue('staff_action_reason')
      .trim();
    const sanction = interaction.fields
      .getTextInputValue('staff_action_sanction')
      .trim();

    if (!reason || !sanction) {
      await interaction.reply({
        content: 'Vul zowel een geldige reden als sanctie in.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (targetMember.roles.cache.has(warnRole.id)) {
      await interaction.reply({
        content:
          `${targetUser} heeft ${warnRole} al. Gebruik eventueel ` +
          '`/warnweg` om die warn eerst te verwijderen.',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    try {
      await targetMember.roles.add(
        warnRole.id,
        `Warn gegeven door ${interaction.user.id}`,
      );
    } catch (error) {
      console.error('Warnrol geven mislukt:', error.message);
      await interaction.reply({
        content:
          'Ik kon de warnrol niet geven. Controleer Rollen beheren ' +
          'en zet mijn botrol boven de warnrol.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle('⚠️ Officiële waarschuwing')
      .addFields(
        {
          name: 'Persoon',
          value: `<@${targetUser.id}>`,
          inline: true,
        },
        {
          name: 'Warn',
          value: `<@&${warnRole.id}>`,
          inline: true,
        },
        {
          name: 'Reden',
          value: shorten(reason, 1024),
        },
        {
          name: 'Sanctie',
          value: shorten(sanction, 1024),
        },
      )
      .setFooter({
        text:
          `Uitgedeeld door ` +
          `${interaction.user.tag ?? interaction.user.username}`,
      })
      .setTimestamp();

    await interaction.reply({
      content: `<@${targetUser.id}>`,
      embeds: [embed],
      allowedMentions: {
        parse: [],
        users: [targetUser.id],
      },
    });

    const logEmbed = makeEmbed(
      'warnings',
      'Warn gegeven',
    ).addFields(
      {
        name: 'Persoon',
        value: `<@${targetUser.id}> (${targetUser.id})`,
      },
      {
        name: 'Warnrol',
        value: `<@&${warnRole.id}> (${warnRole.id})`,
      },
      {
        name: 'Reden',
        value: shorten(reason, 1024),
      },
      {
        name: 'Sanctie',
        value: shorten(sanction, 1024),
      },
      {
        name: 'Uitgedeeld door',
        value: formatUser(interaction.user),
      },
    );
    await sendLog(interaction.guild, 'warnings', logEmbed);
    return;
  }

  if (!targetMember.roles.cache.has(warnRole.id)) {
    await interaction.reply({
      content: `${targetUser} heeft ${warnRole} niet.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  try {
    await targetMember.roles.remove(
      warnRole.id,
      `Warn verwijderd door ${interaction.user.id}`,
    );
  } catch (error) {
    console.error('Warnrol verwijderen mislukt:', error.message);
    await interaction.reply({
      content:
        'Ik kon de warnrol niet verwijderen. Controleer Rollen ' +
        'beheren en de positie van mijn botrol.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle('✅ Waarschuwing verwijderd')
    .addFields(
      {
        name: 'Persoon',
        value: `<@${targetUser.id}>`,
        inline: true,
      },
      {
        name: 'Verwijderde warn',
        value: `<@&${warnRole.id}>`,
        inline: true,
      },
    )
    .setFooter({
      text:
        `Verwijderd door ` +
        `${interaction.user.tag ?? interaction.user.username}`,
    })
    .setTimestamp();

  await interaction.reply({
    content: `<@${targetUser.id}>`,
    embeds: [embed],
    allowedMentions: {
      parse: [],
      users: [targetUser.id],
    },
  });

  const logEmbed = makeEmbed(
    'warnings',
    'Warn verwijderd',
  ).addFields(
    {
      name: 'Persoon',
      value: `<@${targetUser.id}> (${targetUser.id})`,
    },
    {
      name: 'Verwijderde warnrol',
      value: `<@&${warnRole.id}> (${warnRole.id})`,
    },
    {
      name: 'Verwijderd door',
      value: formatUser(interaction.user),
    },
  );
  await sendLog(interaction.guild, 'warnings', logEmbed);
});

// /mededeling: één formulier met tekst, rolkeuze en bestandsupload.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'mededeling' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content:
        'Je hebt de permissie Server beheren nodig om een ' +
        'mededeling te plaatsen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId('announcement:submit')
    .setTitle('Hollow Kings - Nieuwe mededeling');
  const informationInput = new TextInputBuilder()
    .setCustomId('announcement_information')
    .setPlaceholder('Schrijf hier de volledige mededeling')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(4000);
  const informationLabel = new LabelBuilder()
    .setLabel('Informatie dat verstuurd moet worden')
    .setDescription('De volledige tekst voor de mededeling')
    .setTextInputComponent(informationInput);
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('announcement_role')
    .setPlaceholder('Kies de rol die een melding moet krijgen')
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1);
  const roleLabel = new LabelBuilder()
    .setLabel('Role Tagg <@&>')
    .setDescription('Kies één rol voor een echte Discord-melding')
    .setRoleSelectMenuComponent(roleSelect);
  const fileUpload = new FileUploadBuilder()
    .setCustomId('announcement_files')
    .setRequired(false)
    .setMinValues(0)
    .setMaxValues(3);
  const fileLabel = new LabelBuilder()
    .setLabel('Bestanden of foto’s')
    .setDescription('Optioneel: upload maximaal drie bestanden')
    .setFileUploadComponent(fileUpload);

  modal.addLabelComponents(
    informationLabel,
    roleLabel,
    fileLabel,
  );

  try {
    await interaction.showModal(modal);
  } catch (error) {
    console.error('/mededeling openen mislukt:', error.message);
  }
});

// De bot verstuurt het ingevulde formulier openbaar met echte rolping.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isModalSubmit() ||
    interaction.customId !== 'announcement:submit' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content:
        'Je hebt de permissie Server beheren niet meer en kunt ' +
        'de mededeling daarom niet plaatsen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const information =
    interaction.fields
      .getTextInputValue('announcement_information')
      .trim();

  if (!information) {
    await interaction.reply({
      content: 'Vul geldige informatie voor de mededeling in.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedRoles =
    interaction.fields.getSelectedRoles(
      'announcement_role',
      true,
    );
  const role = selectedRoles.first();
  const uploadedFiles =
    interaction.fields.getUploadedFiles(
      'announcement_files',
      false,
    );

  if (!role) {
    await interaction.reply({
      content: 'Kies een geldige rol voor de mededeling.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle('Hollow Kings - Mededeling')
    .setDescription(shorten(information, 4000))
    .addFields({
      name: 'Voor',
      value: `<@&${role.id}>`,
    })
    .setFooter({
      text:
        `Verstuurd door ` +
        `${interaction.user.tag ?? interaction.user.username}`,
    })
    .setTimestamp();
  const files = [...(uploadedFiles?.values() ?? [])].map(
    (attachment, index) => ({
      attachment: attachment.url,
      name:
        String(
          attachment.name ||
            `mededeling-bestand-${index + 1}`,
        ).slice(0, 200),
      description: attachment.description,
    }),
  );

  try {
    await interaction.reply({
      content: `<@&${role.id}>`,
      embeds: [embed],
      files,
      allowedMentions: {
        parse: [],
        roles: [role.id],
      },
    });
  } catch (error) {
    console.error('Mededeling versturen mislukt:', error.message);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content:
          'Ik kon de mededeling niet versturen. Controleer mijn ' +
          'rechten voor Berichten versturen, Links insluiten, ' +
          'Bestanden bijvoegen en Rollen vermelden.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  }
});

// /regel: compact formulier met alleen een grote beschrijving en rolkeuze.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'regel' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content:
        'Je hebt de permissie Server beheren nodig om een regel ' +
        'te plaatsen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const descriptionInput = new TextInputBuilder()
    .setCustomId('rule_description')
    .setPlaceholder('Schrijf hier de volledige regel')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(4000);
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('rule_role')
    .setPlaceholder('Kies de rol die getagd moet worden')
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1);
  const modal = new ModalBuilder()
    .setCustomId('rule:submit')
    .setTitle('Hollow Kings • Nieuwe regel')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Beschrijving')
        .setDescription('De volledige tekst van de regel')
        .setTextInputComponent(descriptionInput),
      new LabelBuilder()
        .setLabel('Role Tagg <@&>')
        .setDescription('Kies één rol voor een echte Discord-melding')
        .setRoleSelectMenuComponent(roleSelect),
    );

  try {
    await interaction.showModal(modal);
  } catch (error) {
    console.error('/regel openen mislukt:', error.message);
  }
});

// De ingevulde regel openbaar plaatsen en de gekozen rol echt pingen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isModalSubmit() ||
    interaction.customId !== 'rule:submit' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content:
        'Je hebt de permissie Server beheren niet meer en kunt ' +
        'de regel daarom niet plaatsen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const description = interaction.fields
    .getTextInputValue('rule_description')
    .trim();
  const role = interaction.fields
    .getSelectedRoles('rule_role', true)
    .first();

  if (!description || !role) {
    await interaction.reply({
      content: 'Vul een geldige beschrijving in en kies één rol.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    !canMentionPointsSubmissionRole(
      interaction.guild,
      interaction.channel,
      role,
    )
  ) {
    await interaction.reply({
      content:
        `Ik kan <@&${role.id}> niet echt pingen. Maak de rol ` +
        'vermeldbaar of geef de bot de permissie Iedereen, @here ' +
        'en alle rollen vermelden.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0xD4AF37)
    .setTitle('📜 Hollow Kings • Regel')
    .setDescription(shorten(description, 4000))
    .addFields({
      name: 'Voor',
      value: `<@&${role.id}>`,
    })
    .setFooter({
      text:
        `Geplaatst door ` +
        `${interaction.user.tag ?? interaction.user.username}`,
    })
    .setTimestamp();

  try {
    await interaction.reply({
      content: `<@&${role.id}>`,
      embeds: [embed],
      allowedMentions: {
        parse: [],
        roles: [role.id],
      },
    });

    const logEmbed = makeEmbed('server', '/regel gebruikt')
      .addFields(
        { name: 'Gebruiker', value: formatUser(interaction.user) },
        { name: 'Kanaal', value: `<#${interaction.channelId}>` },
        { name: 'Getagde rol', value: `<@&${role.id}> (${role.id})` },
        { name: 'Regel', value: shorten(description, 1024) },
      );
    await sendLog(interaction.guild, 'server', logEmbed);
  } catch (error) {
    console.error('/regel versturen mislukt:', error.message);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content:
          'Ik kon de regel niet versturen. Controleer mijn rechten ' +
          'voor Berichten verzenden, Links insluiten en Rollen ' +
          'vermelden.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  }
});

// /afwezig: formulier voor gangleden in het huidige kanaal.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'afwezig' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (!memberHasGangRole(interaction.member)) {
    await interaction.reply({
      content:
        'Alleen leden met een ingestelde gangrangrol kunnen ' +
        'een afwezigheid indienen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId('absence:submit')
    .setTitle('Hollow Kings - Afwezigheid doorgeven');
  const startDateInput = new TextInputBuilder()
    .setCustomId('start_date')
    .setLabel('Startdatum')
    .setPlaceholder('Bijvoorbeeld: 01-08-2026')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(8)
    .setMaxLength(10);
  const endDateInput = new TextInputBuilder()
    .setCustomId('end_date')
    .setLabel('Einddatum')
    .setPlaceholder('Bijvoorbeeld: 07-08-2026')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(8)
    .setMaxLength(10);
  const reasonInput = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reden van afwezigheid')
    .setPlaceholder('Omschrijf kort waarom je afwezig bent')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(500);
  const detailsInput = new TextInputBuilder()
    .setCustomId('details')
    .setLabel('Extra toelichting')
    .setPlaceholder('Eventuele aanvullende informatie')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000);

  modal.addComponents(
    new ActionRowBuilder().addComponents(startDateInput),
    new ActionRowBuilder().addComponents(endDateInput),
    new ActionRowBuilder().addComponents(reasonInput),
    new ActionRowBuilder().addComponents(detailsInput),
  );

  await interaction.showModal(modal);
});

// Ingevuld afwezigheidsformulier omzetten naar de vaste Hollow Kings-template.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isModalSubmit() ||
    interaction.customId !== 'absence:submit' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (!memberHasGangRole(interaction.member)) {
    await interaction.reply({
      content:
        'Je hebt geen ingestelde gangrangrol meer en kunt deze ' +
        'aanvraag daarom niet plaatsen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const startDate = parseAbsenceDate(
    interaction.fields.getTextInputValue('start_date'),
  );
  const endDate = parseAbsenceDate(
    interaction.fields.getTextInputValue('end_date'),
  );
  const reason =
    interaction.fields.getTextInputValue('reason').trim();
  const details =
    interaction.fields.getTextInputValue('details').trim();

  if (!startDate || !endDate) {
    await interaction.reply({
      content:
        'Gebruik voor beide datums het formaat `DD-MM-JJJJ`, ' +
        'bijvoorbeeld `01-08-2026`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (endDate.timestamp < startDate.timestamp) {
    await interaction.reply({
      content: 'De einddatum kan niet vóór de startdatum liggen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!reason) {
    await interaction.reply({
      content: 'Vul een geldige reden voor de afwezigheid in.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = buildAbsenceRequestEmbed({
    user: interaction.user,
    startDate,
    endDate,
    reason,
    details,
  });
  const reviewButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`absence:approve:${interaction.user.id}`)
      .setLabel('Goedkeuren')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`absence:reject:${interaction.user.id}`)
      .setLabel('Afwijzen')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.reply({
    embeds: [embed],
    components: [reviewButtons],
    allowedMentions: { parse: [] },
  });
});

// Alleen de vaste Hollow Kings-leidingrol kan een afwezigheid beoordelen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isButton() ||
    !interaction.customId.startsWith('absence:') ||
    !interaction.inGuild()
  ) {
    return;
  }

  const [, action, requesterId] =
    interaction.customId.split(':');

  if (
    !['approve', 'reject'].includes(action) ||
    !/^\d+$/.test(requesterId ?? '')
  ) {
    return;
  }

  if (!memberCanUseStaffActions(interaction)) {
    await interaction.reply({
      content:
        `Alleen leden met <@&${STAFF_ACTION_ROLE_ID}> mogen deze ` +
        'afwezigheidsaanvraag beoordelen.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  const originalEmbed = interaction.message.embeds?.[0];

  if (!originalEmbed) {
    await interaction.reply({
      content: 'De oorspronkelijke afwezigheidstemplate ontbreekt.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const originalFields =
    originalEmbed.fields ?? originalEmbed.data?.fields ?? [];
  const startDateField = originalFields.find(
    field => field.name === 'Startdatum',
  );
  const endDateField = originalFields.find(
    field => field.name === 'Einddatum',
  );
  const startDate = parseAbsenceDate(startDateField?.value);
  const endDate = parseAbsenceDate(endDateField?.value);

  if (action === 'reject') {
    const reviewedEmbed = buildReviewedAbsenceEmbed(
      originalEmbed,
      action,
      interaction.user,
    );

    await interaction.update({
      embeds: [reviewedEmbed],
      components: [],
      allowedMentions: { parse: [] },
    });

    const logEmbed = makeEmbed(
      'absence',
      'Afwezigheidsaanvraag afgewezen',
    )
      .setColor(0xED4245)
      .addFields(
      {
        name: 'Aanvrager',
        value: `<@${requesterId}>`,
      },
      {
        name: 'Afgekeurd door',
        value: formatUser(interaction.user),
      },
      {
        name: 'Aangevraagde periode',
        value:
          startDate && endDate
            ? `${startDate.display} t/m ${endDate.display}`
            : 'Niet beschikbaar',
      },
      {
        name: 'Aangevraagde duur',
        value:
          startDate && endDate
            ? `${calculateAbsenceDurationDays(
                startDate,
                endDate,
              )} dagen`
            : 'Niet beschikbaar',
      },
      {
        name: 'Aanvraag',
        value: `[Open het bericht](${interaction.message.url})`,
      },
    );

    await sendLog(interaction.guild, 'absence', logEmbed);
    return;
  }

  if (!ABSENCE_ROLE_ID) {
    await interaction.reply({
      content:
        '`ABSENCE_ROLE_ID` ontbreekt bij de Railway-variables. ' +
        'Daardoor kan ik de afwezigheidsrol nog niet geven.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!absenceStoreReady) {
    await interaction.reply({
      content:
        'De afwezigheidsopslag is niet beschikbaar. De aanvraag is ' +
        'niet goedgekeurd; controleer de Railway-logs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!startDate || !endDate) {
    await interaction.reply({
      content:
        'Ik kan de start- of einddatum niet uit deze aanvraag lezen. ' +
        'Laat het lid `/afwezig` opnieuw invullen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (hasAbsenceEndDatePassed(endDate)) {
    await interaction.reply({
      content:
        `De einddatum ${endDate.display} is al voorbij. ` +
        'Deze aanvraag kan niet meer worden goedgekeurd.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  const absenceRole =
    interaction.guild.roles.cache.get(ABSENCE_ROLE_ID) ??
    (await interaction.guild.roles
      .fetch(ABSENCE_ROLE_ID)
      .catch(() => null));
  const member =
    interaction.guild.members.cache.get(requesterId) ??
    (await interaction.guild.members
      .fetch(requesterId)
      .catch(() => null));
  const botMember = interaction.guild.members.me;

  if (!absenceRole) {
    await interaction.followUp({
      content:
        `De afwezigheidsrol met ID ${ABSENCE_ROLE_ID} is niet ` +
        'gevonden in deze server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!member) {
    await interaction.followUp({
      content: 'Het lid van deze aanvraag is niet meer in de server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    !botMember?.permissions.has(PermissionFlagsBits.ManageRoles) ||
    !absenceRole.editable
  ) {
    await interaction.followUp({
      content:
        'Ik kan de afwezigheidsrol niet beheren. Geef mij Rollen ' +
        'beheren en zet mijn botrol boven de afwezigheidsrol.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const recordKey = absenceRecordKey(
    interaction.guildId,
    requesterId,
  );
  const previousRecord = absenceData.approved[recordKey];
  const alreadyHadRole =
    member.roles.cache.has(ABSENCE_ROLE_ID);

  try {
    if (!alreadyHadRole) {
      await member.roles.add(
        ABSENCE_ROLE_ID,
        `Afwezigheid goedgekeurd door ${interaction.user.id}`,
      );
    }

    absenceData.approved[recordKey] = {
      guildId: interaction.guildId,
      userId: requesterId,
      roleId: ABSENCE_ROLE_ID,
      startDate: {
        day: startDate.day,
        month: startDate.month,
        year: startDate.year,
      },
      endDate: {
        day: endDate.day,
        month: endDate.month,
        year: endDate.year,
      },
      approvedAt: new Date().toISOString(),
      approvedBy: interaction.user.id,
      sourceChannelId: interaction.channelId,
      sourceMessageId: interaction.message.id,
    };

    try {
      await queueAbsenceSave();
    } catch (error) {
      if (previousRecord) {
        absenceData.approved[recordKey] = previousRecord;
      } else {
        delete absenceData.approved[recordKey];
      }

      if (!alreadyHadRole) {
        await member.roles.remove(
          ABSENCE_ROLE_ID,
          'Opslaan van afwezigheid mislukt',
        ).catch(() => {});
      }

      throw error;
    }

    const reviewedEmbed = buildReviewedAbsenceEmbed(
      originalEmbed,
      action,
      interaction.user,
    ).addFields({
      name: 'Afwezigheidsrol',
      value:
        `<@&${ABSENCE_ROLE_ID}> actief t/m ` +
        `${endDate.display}; daarna automatisch verwijderd.`,
    });

    await interaction.editReply({
      embeds: [reviewedEmbed],
      components: [],
      allowedMentions: { parse: [] },
    });

    await interaction.followUp({
      content:
        `De afwezigheidsrol is aan ${member} gegeven t/m ` +
        `${endDate.display} en wordt daarna automatisch verwijderd.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });

    const logEmbed = makeEmbed(
      'absence',
      'Afwezigheidsaanvraag goedgekeurd',
    )
      .setColor(0x57F287)
      .addFields(
      {
        name: 'Afwezig lid',
        value: formatUser(member.user),
      },
      {
        name: 'Goedgekeurd door',
        value: formatUser(interaction.user),
      },
      {
        name: 'Periode',
        value: `${startDate.display} t/m ${endDate.display}`,
      },
      {
        name: 'Totale duur',
        value:
          `${calculateAbsenceDurationDays(
            startDate,
            endDate,
          )} dagen`,
      },
      {
        name: 'Rol',
        value: `<@&${ABSENCE_ROLE_ID}>`,
      },
      {
        name: 'Aanvraag',
        value: `[Open het bericht](${interaction.message.url})`,
      },
    );

    await sendLog(interaction.guild, 'absence', logEmbed);
  } catch (error) {
    console.error(
      'Afwezigheidsrol toekennen of opslaan mislukt:',
      error,
    );
    await interaction.followUp({
      content:
        'De afwezigheidsrol kon niet veilig worden toegekend en ' +
        'opgeslagen. Controleer mijn rolpositie en de Railway-volume.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
});

// /aanvraag: formulier voor een nieuwe verwerkaanvraag.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'aanvraag' ||
    !interaction.inGuild()
  ) {
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId('processing-request:submit')
    .setTitle('Hollow Kings - Aanvraag Verwerk');
  const nameInput = new TextInputBuilder()
    .setCustomId('request_name')
    .setLabel('Naam')
    .setPlaceholder('Vul je naam in')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(100);
  const timeInput = new TextInputBuilder()
    .setCustomId('request_time')
    .setLabel('Tijdstip aanvraag')
    .setPlaceholder('Bijvoorbeeld: 20:30')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(5);
  const portoCountInput = new TextInputBuilder()
    .setCustomId('request_porto_count')
    .setLabel('Hoeveel man porto')
    .setPlaceholder('Bijvoorbeeld: 4')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(3);
  const amountInput = new TextInputBuilder()
    .setCustomId('request_amount')
    .setLabel('Hoeveelheid')
    .setPlaceholder('Vul de aangevraagde hoeveelheid in')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(100);
  const dateInput = new TextInputBuilder()
    .setCustomId('request_date')
    .setLabel('Datum')
    .setPlaceholder('DD/MM/JJJJ')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(8)
    .setMaxLength(10);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(timeInput),
    new ActionRowBuilder().addComponents(portoCountInput),
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(dateInput),
  );

  await interaction.showModal(modal);
});

// De bot plaatst het formulier als openbare aanvraag met beheerknoppen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isModalSubmit() ||
    interaction.customId !== 'processing-request:submit' ||
    !interaction.inGuild()
  ) {
    return;
  }

  const name =
    interaction.fields.getTextInputValue('request_name').trim();
  const requestTime = parseProcessingRequestTime(
    interaction.fields.getTextInputValue('request_time'),
  );
  const portoCountText =
    interaction.fields
      .getTextInputValue('request_porto_count')
      .trim();
  const amount =
    interaction.fields.getTextInputValue('request_amount').trim();
  const requestDate = parseAbsenceDate(
    interaction.fields.getTextInputValue('request_date'),
  );

  if (!name || !amount) {
    await interaction.reply({
      content: 'Vul alle verplichte velden geldig in.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!requestTime) {
    await interaction.reply({
      content:
        'Gebruik voor het tijdstip het formaat `UU:MM`, ' +
        'bijvoorbeeld `20:30`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    !/^\d{1,3}$/.test(portoCountText) ||
    Number.parseInt(portoCountText, 10) < 1
  ) {
    await interaction.reply({
      content:
        'Vul bij “Hoeveel man porto” een positief heel getal in.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!requestDate) {
    await interaction.reply({
      content:
        'Gebruik voor de datum het formaat `DD/MM/JJJJ`, ' +
        'bijvoorbeeld `28/07/2026`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel || typeof channel.send !== 'function') {
    await interaction.reply({
      content: 'In dit kanaal kan ik geen aanvraag plaatsen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const portoCount = Number.parseInt(portoCountText, 10);
  const requestEmbed = buildProcessingRequestEmbed({
    user: interaction.user,
    name,
    requestTime,
    portoCount,
    amount,
    requestDate,
  });
  const reviewButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `processing-request:approve:${interaction.user.id}`,
      )
      .setLabel('Goedkeuren')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(
        `processing-request:reject:${interaction.user.id}`,
      )
      .setLabel('Afkeuren')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const postedMessage = await channel.send({
      embeds: [requestEmbed],
      components: [reviewButtons],
      allowedMentions: { parse: [] },
    });

    await interaction.editReply(
      'Je verwerkaanvraag is door de bot geplaatst en wacht op beheer.',
    );

    const logEmbed = new EmbedBuilder()
      .setColor(0xF1C40F)
      .setTitle('🟡 Nieuwe verwerkaanvraag')
      .addFields(
        {
          name: 'Aanvrager',
          value: formatUser(interaction.user),
        },
        { name: 'Naam', value: shorten(name) },
        {
          name: 'Tijdstip',
          value: requestTime,
          inline: true,
        },
        {
          name: 'Man porto',
          value: String(portoCount),
          inline: true,
        },
        {
          name: 'Hoeveelheid',
          value: shorten(amount),
          inline: true,
        },
        {
          name: 'Datum',
          value: requestDate.display.replaceAll('-', '/'),
          inline: true,
        },
        {
          name: 'Aanvraag',
          value: `[Open het bericht](${postedMessage.url})`,
        },
      )
      .setTimestamp();

    await sendLog(interaction.guild, 'pluk', logEmbed);
  } catch (error) {
    console.error('/aanvraag plaatsen mislukt:', error);
    await interaction.editReply(
      'De aanvraag kon niet worden geplaatst. Controleer mijn ' +
      'permissie om berichten en embeds te versturen.',
    );
  }
});

// Alleen beheer kan een verwerkaanvraag goed- of afkeuren.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isButton() ||
    !interaction.customId.startsWith('processing-request:') ||
    !interaction.inGuild()
  ) {
    return;
  }

  const [, action, requesterId] =
    interaction.customId.split(':');

  if (
    !['approve', 'reject'].includes(action) ||
    !/^\d+$/.test(requesterId ?? '')
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content:
        'Je hebt de permissie Server beheren nodig om deze ' +
        'aanvraag te beoordelen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const originalEmbed = interaction.message.embeds?.[0];

  if (!originalEmbed) {
    await interaction.reply({
      content: 'De oorspronkelijke aanvraagtemplate ontbreekt.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const originalFields =
    originalEmbed.fields ?? originalEmbed.data?.fields ?? [];
  const requesterName =
    originalFields.find(field => field.name === 'Naam')?.value ??
    'Onbekend';
  const amountText =
    originalFields.find(
      field => field.name === 'Hoeveelheid',
    )?.value ?? 'Onbekend';
  const amountValue =
    parseProcessingAmountNumber(amountText);
  const approved = action === 'approve';
  const reviewedEmbed = buildReviewedProcessingRequestEmbed(
    originalEmbed,
    action,
    interaction.user,
  );

  await interaction.update({
    embeds: [reviewedEmbed],
    components: [],
    allowedMentions: { parse: [] },
  });

  let reminderDueAt = null;
  let reminderError = null;
  let startNotificationSent = false;
  let startNotificationError = null;

  if (
    approved &&
    amountValue !== null &&
    amountValue >= PROCESSING_REMINDER_THRESHOLD
  ) {
    try {
      reminderDueAt = await scheduleProcessingReminder({
        guildId: interaction.guildId,
        requesterId,
        requesterName,
        amountText,
        amountValue,
        approvedBy: interaction.user.id,
        sourceChannelId: interaction.channelId,
        sourceMessageId: interaction.message.id,
        sourceMessageUrl: interaction.message.url,
      });

      try {
        await sendProcessingReminderStarted({
          guild: interaction.guild,
          requesterId,
          requesterName,
          amountText,
          approvedBy: interaction.user.id,
          dueAt: reminderDueAt,
          sourceMessageUrl: interaction.message.url,
        });
        startNotificationSent = true;
      } catch (error) {
        startNotificationError = error;
        console.error(
          'Startmelding grote verwerkaanvraag mislukt:',
          error.message,
        );
      }
    } catch (error) {
      reminderError = error;
      console.error(
        'Grote verwerkaanvraag-herinnering inplannen mislukt:',
        error,
      );
    }
  }

  const logEmbed = new EmbedBuilder()
    .setColor(approved ? 0x57F287 : 0xED4245)
    .setTitle(
      approved
        ? '✅ Verwerkaanvraag goedgekeurd'
        : '❌ Verwerkaanvraag afgekeurd',
    )
    .addFields(
      {
        name: 'Aanvrager',
        value: `<@${requesterId}>`,
      },
      {
        name: 'Beoordeeld door',
        value: formatUser(interaction.user),
      },
      {
        name: 'Beslissing',
        value: approved ? 'Goedgekeurd' : 'Afgekeurd',
      },
      {
        name: 'Hoeveelheid',
        value:
          amountValue === null
            ? shorten(amountText)
            : `${shorten(amountText)} (gelezen als ${amountValue})`,
      },
      {
        name: 'Aanvraag',
        value: `[Open het bericht](${interaction.message.url})`,
      },
    )
    .setTimestamp();

  if (reminderDueAt) {
    logEmbed.addFields({
      name: 'Herinnering',
      value:
        `Ingepland voor ` +
        `<t:${Math.floor(reminderDueAt / 1000)}:F>`,
    });

    logEmbed.addFields({
      name: 'Startmelding',
      value: startNotificationSent
        ? `Verstuurd naar ` +
          `<#${PROCESSING_REMINDER_CHANNEL_ID}> met afteller`
        : `Niet verstuurd: ` +
          `${shorten(startNotificationError?.message)}`,
    });
  } else if (reminderError) {
    logEmbed.addFields({
      name: 'Herinnering',
      value: 'Kon niet worden ingepland; controleer Railway.',
    });
  }

  await sendLog(interaction.guild, 'pluk', logEmbed);

  if (reminderDueAt) {
    const destinationText =
      PROCESSING_REMINDER_CHANNEL_ID
        ? `<#${PROCESSING_REMINDER_CHANNEL_ID}>`
        : 'het nog in te stellen herinneringskanaal';

    await interaction.followUp({
      content:
        startNotificationSent
          ? `Omdat de hoeveelheid ${amountValue} is, is er direct ` +
            `een melding met live afteller geplaatst in ` +
            `${destinationText}. De eindmelding volgt ` +
            `<t:${Math.floor(reminderDueAt / 1000)}:R>.`
          : `De herinnering voor hoeveelheid ${amountValue} staat ` +
            `wel gepland voor ` +
            `<t:${Math.floor(reminderDueAt / 1000)}:R>, maar de ` +
            `eerste melding kon niet worden verstuurd. Controleer ` +
            `het kanaal en de botpermissies.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    }).catch(() => {});
  } else if (reminderError) {
    await interaction.followUp({
      content:
        'De aanvraag is wel goedgekeurd, maar de herinnering kon ' +
        'niet worden opgeslagen. Controleer de Railway-logs.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
});

// /wapendealer: privé winkelmandje voor leden met de ingestelde dealerrol.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'wapendealer' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (!WEAPON_DEALER_ROLE_ID) {
    await interaction.reply({
      content:
        '`WEAPON_DEALER_ROLE_ID` ontbreekt bij de Railway-variables.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    !interactionMemberHasRole(interaction, WEAPON_DEALER_ROLE_ID)
  ) {
    await interaction.reply({
      content: 'Alleen leden met de ingestelde wapendealerrol mogen dit.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const customer = interaction.options.getUser('klant', true);

  if (customer.bot) {
    await interaction.reply({
      content: 'Kies een echt Discord-lid als klant, geen bot.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  cleanupDealerSessions();

  const session = {
    id: interaction.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    dealerId: interaction.user.id,
    customerId: customer.id,
    categoryId: null,
    cart: new Map(),
    notice: null,
    expiresAt: Date.now() + DEALER_SESSION_DURATION_MS,
  };

  dealerSessions.set(session.id, session);

  try {
    await interaction.reply({
      ...buildDealerPanel(session),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    dealerSessions.delete(session.id);
    console.error('/wapendealer openen mislukt:', error.message);
  }
});

// Categorieën, artikelen, aantallen en bevestiging van /wapendealer.
client.on(Events.InteractionCreate, async interaction => {
  if (
    (
      !interaction.isButton() &&
      !interaction.isStringSelectMenu() &&
      !interaction.isModalSubmit()
    ) ||
    !interaction.customId.startsWith('dealer:')
  ) {
    return;
  }

  const [, action, sessionId, itemId] =
    interaction.customId.split(':');
  const session =
    await getActiveDealerSession(interaction, sessionId);

  if (!session) return;

  try {
    if (
      action === 'category' &&
      interaction.isStringSelectMenu()
    ) {
      const category = DEALER_CATALOG.find(
        entry => entry.id === interaction.values[0],
      );

      if (!category) {
        await replyDealerError(
          interaction,
          'Deze categorie bestaat niet meer.',
        );
        return;
      }

      session.categoryId = category.id;
      session.notice = null;
      await interaction.update(buildDealerPanel(session));
      return;
    }

    if (
      action === 'item' &&
      interaction.isStringSelectMenu()
    ) {
      const selectedItem = DEALER_ITEMS.get(interaction.values[0]);

      if (
        !selectedItem ||
        selectedItem.categoryId !== session.categoryId
      ) {
        await replyDealerError(
          interaction,
          'Dit artikel bestaat niet meer in deze categorie.',
        );
        return;
      }

      const currentQuantity =
        session.cart.get(selectedItem.id) ?? 1;
      const modal = new ModalBuilder()
        .setCustomId(
          `dealer:quantity:${session.id}:${selectedItem.id}`,
        )
        .setTitle(shorten(`Aantal - ${selectedItem.name}`, 45));
      const quantityInput = new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel('Aantal (0 verwijdert het artikel)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(3)
        .setValue(String(currentQuantity))
        .setPlaceholder('Bijvoorbeeld: 2');

      modal.addComponents(
        new ActionRowBuilder().addComponents(quantityInput),
      );
      await interaction.showModal(modal);
      return;
    }

    if (
      action === 'quantity' &&
      interaction.isModalSubmit()
    ) {
      const selectedItem = DEALER_ITEMS.get(itemId);
      const quantityText =
        interaction.fields.getTextInputValue('quantity').trim();

      if (!selectedItem) {
        await replyDealerError(
          interaction,
          'Dit artikel bestaat niet meer.',
        );
        return;
      }

      if (!/^(0|[1-9]\d{0,2})$/.test(quantityText)) {
        await replyDealerError(
          interaction,
          'Vul een heel aantal van 0 tot en met 999 in.',
        );
        return;
      }

      const quantity = Number.parseInt(quantityText, 10);

      if (
        quantity > 0 &&
        !session.cart.has(selectedItem.id) &&
        session.cart.size >= DEALER_MAX_CART_ITEMS
      ) {
        await replyDealerError(
          interaction,
          `Je kunt maximaal ${DEALER_MAX_CART_ITEMS} ` +
            'verschillende artikelen tegelijk bestellen.',
        );
        return;
      }

      if (quantity === 0) {
        session.cart.delete(selectedItem.id);
        session.notice = `🗑️ **${selectedItem.name}** is verwijderd.`;
      } else {
        session.cart.set(selectedItem.id, quantity);
        session.notice =
          `✅ **${quantity}x ${selectedItem.name}** staat in het mandje.`;
      }

      await interaction.update(buildDealerPanel(session));
      return;
    }

    if (!interaction.isButton()) return;

    if (action === 'back') {
      session.categoryId = null;
      session.notice = null;
      await interaction.update(buildDealerPanel(session));
      return;
    }

    if (action === 'clear') {
      session.cart.clear();
      session.notice = '🗑️ Het winkelmandje is geleegd.';
      await interaction.update(buildDealerPanel(session));
      return;
    }

    if (action === 'cancel') {
      dealerSessions.delete(session.id);
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('Wapenbestelling geannuleerd')
            .setDescription('Er is niets in het kanaal geplaatst.')
            .setTimestamp(),
        ],
        components: [],
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (action === 'confirm') {
      if (!session.cart.size) {
        await replyDealerError(
          interaction,
          'Het winkelmandje is leeg.',
        );
        return;
      }

      if (
        !interaction.channel ||
        typeof interaction.channel.send !== 'function'
      ) {
        await replyDealerError(
          interaction,
          'Ik kan in dit kanaal geen bestelling plaatsen.',
        );
        return;
      }

      await interaction.deferUpdate();
      const orderEmbed = buildDealerOrderEmbed(session);

      try {
        await interaction.channel.send({
          embeds: [orderEmbed],
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        console.error(
          'Wapenbestelling plaatsen mislukt:',
          error.message,
        );
        await interaction.followUp({
          content:
            'Ik kon de bestelling niet in dit kanaal plaatsen. ' +
            'Controleer mijn rechten voor Berichten versturen en ' +
            'Links insluiten.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const total = calculateDealerCartTotal(session);
      dealerSessions.delete(session.id);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('Bestelling geplaatst')
            .setDescription(
              `De bestelling van <@${session.customerId}> is in ` +
              `dit kanaal geplaatst.\n\n` +
              `**Totaal:** ${formatDealerPrice(total)}`,
            )
            .setTimestamp(),
        ],
        components: [],
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    console.error('Wapendealermenu-fout:', error);
    await replyDealerError(
      interaction,
      'Er ging iets mis in het wapendealermenu. Probeer het opnieuw.',
    ).catch(() => {});
  }
});

// /zeg: alleen leden met de permissie Berichten beheren.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'zeg' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Berichten beheren nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.options.getChannel('kanaal', true);
  const messageText = interaction.options.getString('bericht', true);

  if (!channel || typeof channel.send !== 'function') {
    await interaction.reply({
      content: 'In dit kanaal kan ik geen berichten sturen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botMember = interaction.guild.members.me;
  const botPermissions = botMember
    ? channel.permissionsFor(botMember)
    : null;

  if (
    !botPermissions?.has(PermissionFlagsBits.ViewChannel) ||
    !botPermissions.has(PermissionFlagsBits.SendMessages)
  ) {
    await interaction.reply({
      content: 'Ik heb in dat kanaal View Channel en Send Messages nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await channel.send({
      content: messageText,
      allowedMentions: { parse: [] },
    });

    await interaction.editReply(`Bericht verstuurd naar ${channel}.`);

    const embed = makeEmbed('server', '/zeg gebruikt')
      .addFields(
        { name: 'Gebruiker', value: formatUser(interaction.user) },
        { name: 'Kanaal', value: `${channel.name} (${channel.id})` },
        { name: 'Bericht', value: shorten(messageText) },
      );

    await sendLog(interaction.guild, 'server', embed);
  } catch (error) {
    console.error('/zeg-fout:', error);
    await interaction.editReply(
      'Het versturen is mislukt. Controleer mijn kanaalpermissies.',
    );
  }
});

// Vaste open-/dichtmelding voor sollicitaties.
client.on(Events.InteractionCreate, async interaction => {
  const applicationCommands = [
    'sollicitatietrue',
    'sollicitatiefalse',
  ];

  if (
    !interaction.isChatInputCommand() ||
    !applicationCommands.includes(interaction.commandName) ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel || typeof channel.send !== 'function') {
    await interaction.reply({
      content: 'In dit kanaal kan ik geen sollicitatiemelding plaatsen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botMember = interaction.guild.members.me;
  const botPermissions = botMember
    ? channel.permissionsFor(botMember)
    : null;
  const bannerExists = existsSync(APPLICATION_BANNER_PATH);

  if (
    !botPermissions?.has(PermissionFlagsBits.ViewChannel) ||
    !botPermissions.has(PermissionFlagsBits.SendMessages) ||
    !botPermissions.has(PermissionFlagsBits.EmbedLinks) ||
    (bannerExists &&
      !botPermissions.has(PermissionFlagsBits.AttachFiles))
  ) {
    await interaction.reply({
      content:
        'Ik heb in dit kanaal Kanaal bekijken, Berichten verzenden, ' +
        'Links insluiten en Bestanden bijvoegen nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const applicationRole =
    interaction.guild.roles.cache.get(APPLICATION_ROLE_ID) ??
    (await interaction.guild.roles
      .fetch(APPLICATION_ROLE_ID)
      .catch(() => null));

  if (!applicationRole) {
    await interaction.reply({
      content:
        `De rol met ID ${APPLICATION_ROLE_ID} is niet gevonden in deze server.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    !applicationRole.mentionable &&
    !botPermissions.has(PermissionFlagsBits.MentionEveryone)
  ) {
    await interaction.reply({
      content:
        `Ik kan ${applicationRole} nog niet vermelden. Maak de rol ` +
        'vermeldbaar of geef mij de permissie Iedereen, @here en alle ' +
        'rollen vermelden.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const isOpen = interaction.commandName === 'sollicitatietrue';
  const status = isOpen ? 'open' : 'closed';
  const embed = new EmbedBuilder()
    .setColor(isOpen ? 0x57F287 : 0xED4245)
    .setTitle('Hollow Kings Sollicitaties')
    .setDescription(APPLICATION_MESSAGES[status])
    .setFooter({ text: 'Hollow Kings' })
    .setTimestamp();

  const announcement = {
    content: `<@&${APPLICATION_ROLE_ID}>`,
    embeds: [embed],
    allowedMentions: {
      parse: [],
      roles: [APPLICATION_ROLE_ID],
    },
  };

  if (bannerExists) {
    embed.setImage(`attachment://${APPLICATION_BANNER_NAME}`);
    announcement.files = [
      {
        attachment: APPLICATION_BANNER_PATH,
        name: APPLICATION_BANNER_NAME,
      },
    ];
  } else {
    console.error(
      `Sollicitatiebanner ontbreekt: ${APPLICATION_BANNER_PATH}`,
    );
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await channel.send(announcement);
    await interaction.editReply(
      isOpen
        ? 'De melding ‘Sollicitaties geopend’ is geplaatst.'
        : 'De melding ‘Sollicitaties gesloten’ is geplaatst.',
    );

    const logEmbed = makeEmbed(
      'server',
      isOpen
        ? '/sollicitatietrue gebruikt'
        : '/sollicitatiefalse gebruikt',
    ).addFields(
      { name: 'Gebruiker', value: formatUser(interaction.user) },
      { name: 'Kanaal', value: `${channel.name} (${channel.id})` },
      {
        name: 'Status',
        value: isOpen ? 'Sollicitaties geopend' : 'Sollicitaties gesloten',
      },
    );

    await sendLog(interaction.guild, 'server', logEmbed);
  } catch (error) {
    console.error('/sollicitatie-fout:', error);
    await interaction.editReply(
      'De sollicitatiemelding kon niet worden geplaatst. ' +
      'Controleer mijn kanaalpermissies.',
    );
  }
});

// Vaste open-/dichtmelding voor de Pluk Status.
client.on(Events.InteractionCreate, async interaction => {
  const plukCommands = ['plukopen', 'plukdicht'];

  if (
    !interaction.isChatInputCommand() ||
    !plukCommands.includes(interaction.commandName) ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel || typeof channel.send !== 'function') {
    await interaction.reply({
      content: 'In dit kanaal kan ik geen plukstatus plaatsen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botMember = interaction.guild.members.me;
  const botPermissions = botMember
    ? channel.permissionsFor(botMember)
    : null;
  const bannerExists = existsSync(PLUK_BANNER_PATH);

  if (
    !botPermissions?.has(PermissionFlagsBits.ViewChannel) ||
    !botPermissions.has(PermissionFlagsBits.SendMessages) ||
    !botPermissions.has(PermissionFlagsBits.EmbedLinks) ||
    (bannerExists &&
      !botPermissions.has(PermissionFlagsBits.AttachFiles))
  ) {
    await interaction.reply({
      content:
        'Ik heb in dit kanaal Kanaal bekijken, Berichten verzenden, ' +
        'Links insluiten en Bestanden bijvoegen nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const plukRole =
    interaction.guild.roles.cache.get(PLUK_ROLE_ID) ??
    (await interaction.guild.roles
      .fetch(PLUK_ROLE_ID)
      .catch(() => null));

  if (!plukRole) {
    await interaction.reply({
      content:
        `De rol met ID ${PLUK_ROLE_ID} is niet gevonden in deze server.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    !plukRole.mentionable &&
    !botPermissions.has(PermissionFlagsBits.MentionEveryone)
  ) {
    await interaction.reply({
      content:
        `Ik kan ${plukRole} nog niet vermelden. Maak de rol ` +
        'vermeldbaar of geef mij de permissie Iedereen, @here en alle ' +
        'rollen vermelden.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const isOpen = interaction.commandName === 'plukopen';
  const statusColor = isOpen ? 0x57F287 : 0xED4245;
  const statusEmbed = new EmbedBuilder()
    .setColor(statusColor)
    .setTitle(
      isOpen
        ? '🟢 Pluk Status — OPEN'
        : '❌ Pluk Status — GESLOTEN',
    )
    .setDescription(
      isOpen
        ? [
            '## Status',
            '**Pluk open 🟢**',
            '',
            'Iedereen mag plukken.',
          ].join('\n')
        : [
            '## Status',
            '**Pluk gesloten ❌**',
            '',
            'Iedereen die wél plukt, krijgt een warn.',
          ].join('\n'),
    )
    .setFooter({ text: 'Hollow Kings • Pluk Status' })
    .setTimestamp();
  const statusMessage = {
    content: `<@&${PLUK_ROLE_ID}>`,
    embeds: [statusEmbed],
    allowedMentions: {
      parse: [],
      roles: [PLUK_ROLE_ID],
    },
  };

  if (bannerExists) {
    statusEmbed.setImage(`attachment://${PLUK_BANNER_NAME}`);
    statusMessage.files = [
      {
        attachment: PLUK_BANNER_PATH,
        name: PLUK_BANNER_NAME,
      },
    ];
  } else {
    console.error(`Plukstatuslogo ontbreekt: ${PLUK_BANNER_PATH}`);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const postedMessage = await channel.send(statusMessage);

    await interaction.editReply(
      isOpen
        ? 'De groene melding ‘Pluk open’ is geplaatst.'
        : 'De rode melding ‘Pluk gesloten’ is geplaatst.',
    );

    const logEmbed = new EmbedBuilder()
      .setColor(statusColor)
      .setTitle(
        isOpen
          ? '🟢 Plukstatus geopend'
          : '🔴 Plukstatus gesloten',
      )
      .addFields(
        {
          name: 'Uitgevoerd door',
          value: formatUser(interaction.user),
        },
        {
          name: 'Kanaal',
          value: `${channel.name ?? 'Onbekend'} (${channel.id})`,
        },
        {
          name: 'Commando',
          value: `\`/${interaction.commandName}\``,
          inline: true,
        },
        {
          name: 'Status',
          value: isOpen ? 'Pluk open 🟢' : 'Pluk gesloten ❌',
          inline: true,
        },
        {
          name: 'Gepingde rol',
          value: `<@&${PLUK_ROLE_ID}>`,
        },
        {
          name: 'Statusbericht',
          value: `[Open het bericht](${postedMessage.url})`,
        },
      )
      .setFooter({ text: 'Hollow Kings • Pluklog' })
      .setTimestamp();

    await sendLog(interaction.guild, 'pluk', logEmbed);
  } catch (error) {
    console.error('/plukstatus-fout:', error);
    await interaction.editReply(
      'De plukstatus kon niet worden geplaatst. Controleer mijn ' +
      'kanaalpermissies en het pluk-logkanaal.',
    );
  }
});

// /ledenlijst: alleen accounts met minstens één ingestelde gang-/rangrol.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'ledenlijst' ||
    !interaction.inGuild()
  ) {
    return;
  }

  await interaction.deferReply();

  try {
    const guild = interaction.guild;
    const members =
      guild.members.cache.size >= guild.memberCount
        ? guild.members.cache
        : await guild.members.fetch();

    const assignedMemberIds = new Set();
    const sections = [];

    for (const roleId of RANK_ROLE_IDS) {
      const role = guild.roles.cache.get(roleId);

      if (!role) {
        console.error(`Rangrol niet gevonden: ${roleId}`);
        continue;
      }

      const membersWithRank = [...members.values()]
        .filter(member =>
          !member.user.bot &&
          member.roles.cache.has(roleId) &&
          !assignedMemberIds.has(member.id),
        )
        .sort((memberA, memberB) =>
          memberA.displayName.localeCompare(
            memberB.displayName,
            'nl',
            { sensitivity: 'base' },
          ),
        );

      for (const member of membersWithRank) {
        assignedMemberIds.add(member.id);
      }

      const memberLines = membersWithRank.length
        ? membersWithRank.map(member => `<@${member.id}>`).join('\n')
        : '*Geen leden*';

      sections.push(`<@&${role.id}>\n${memberLines}`);
    }

    const summary =
      `**LEDEN ${assignedMemberIds.size} / ${GANG_MEMBER_LIMIT}**`;
    const pages = [];
    let currentPage = '';

    for (const section of sections) {
      const addition = currentPage ? `\n\n${section}` : section;

      if (currentPage && currentPage.length + addition.length > 1850) {
        pages.push(currentPage);
        currentPage = section;
      } else {
        currentPage += addition;
      }
    }

    if (currentPage) {
      pages.push(currentPage);
    }

    if (!pages.length) {
      pages.push('*Geen geldige rangrollen gevonden.*');
    }

    const lastPageIndex = pages.length - 1;

    if (pages[lastPageIndex].length + summary.length + 2 <= 2000) {
      pages[lastPageIndex] += `\n\n${summary}`;
    } else {
      pages.push(summary);
    }

    await interaction.editReply({
      content: pages[0],
      allowedMentions: { parse: [] },
    });

    for (const page of pages.slice(1)) {
      await interaction.followUp({
        content: page,
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    console.error('/ledenlijst-fout:', error);
    await interaction.editReply(
      'Ik kon de ledenlijst niet ophalen. Controleer Server Members Intent.',
    );
  }
});

function buildPointsProgress(points) {
  const safePoints = Math.max(0, points);
  const nextMilestone =
    POINTS_ACHIEVEMENT_MILESTONES.find(
      milestone => safePoints < milestone.threshold,
    );
  const targetMilestone =
    nextMilestone ??
    POINTS_ACHIEVEMENT_MILESTONES.at(-1);
  const progress = Math.min(
    safePoints,
    targetMilestone.threshold,
  );
  const filledBlocks = Math.floor(
    (progress / targetMilestone.threshold) * 10,
  );
  const progressBar =
    '▰'.repeat(filledBlocks) +
    '▱'.repeat(10 - filledBlocks);

  if (safePoints >= POINTS_HIGHEST_ACHIEVEMENT) {
    return (
      `${progressBar} **${safePoints} punten**\n` +
      '👑 De hoogste mijlpaal van 150 punten is behaald.'
    );
  }

  const remaining =
    targetMilestone.threshold - safePoints;

  return (
    `${progressBar} **${safePoints} / ` +
    `${targetMilestone.threshold} punten**\n` +
    `Nog **${remaining} ${remaining === 1 ? 'punt' : 'punten'}** ` +
    `tot **${targetMilestone.threshold} punten • ` +
    `${targetMilestone.name}**.`
  );
}

function getMemberProfileAbsence(guildId, userId) {
  if (!absenceStoreReady) {
    return '⚪ Afwezigheidsstatus niet beschikbaar';
  }

  const record =
    absenceData.approved[absenceRecordKey(guildId, userId)];
  const startDate = getStoredAbsenceStartDate(record);
  const endDate = getStoredAbsenceEndDate(record);

  if (!record || !endDate || hasAbsenceEndDatePassed(endDate)) {
    return '🟢 Actief';
  }

  return [
    '🏖️ Afwezig',
    startDate
      ? `${startDate.display} t/m ${endDate.display}`
      : `t/m ${endDate.display}`,
  ].join('\n');
}

// /profiel: persoonlijk overzicht van een huidig ganglid.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'profiel' ||
    !interaction.inGuild()
  ) {
    return;
  }

  await interaction.deferReply();

  try {
    const selectedUser =
      interaction.options.getUser('lid') ?? interaction.user;

    if (selectedUser.bot) {
      await interaction.editReply(
        'Bots hebben geen Hollow Kings-ledenprofiel.',
      );
      return;
    }

    const guild = interaction.guild;
    const member =
      guild.members.cache.get(selectedUser.id) ??
      (await guild.members
        .fetch(selectedUser.id)
        .catch(() => null));

    if (!member || !memberHasGangRole(member)) {
      await interaction.editReply(
        'Deze persoon heeft geen ingestelde Hollow Kings-gangrol en heeft ' +
        'daarom geen ledenprofiel.',
      );
      return;
    }

    const members = await getDashboardMembers(guild);
    const totals = pointsStoreReady
      ? calculatePointsTotals(guild.id)
      : new Map();
    const points = totals.get(member.id) ?? 0;
    const rankedMembers = [...members.values()]
      .filter(
        candidate =>
          !candidate.user?.bot &&
          memberHasGangRole(candidate),
      )
      .map(candidate => ({
        member: candidate,
        points: totals.get(candidate.id) ?? 0,
      }))
      .sort(
        (entryA, entryB) =>
          entryB.points - entryA.points ||
          entryA.member.displayName.localeCompare(
            entryB.member.displayName,
            'nl',
            { sensitivity: 'base' },
          ),
      );
    const pointsPosition =
      rankedMembers.findIndex(
        entry => entry.member.id === member.id,
      ) + 1;
    const rankRoles = RANK_ROLE_IDS
      .map(roleId => member.roles.cache.get(roleId))
      .filter(Boolean);
    const currentRank = rankRoles[0];
    const joinedTimestamp = Number.isFinite(member.joinedTimestamp)
      ? Math.floor(member.joinedTimestamp / 1000)
      : null;
    const accountTimestamp = Number.isFinite(
      selectedUser.createdTimestamp,
    )
      ? Math.floor(selectedUser.createdTimestamp / 1000)
      : null;
    const avatarUrl =
      typeof member.displayAvatarURL === 'function'
        ? member.displayAvatarURL({ size: 512 })
        : typeof selectedUser.displayAvatarURL === 'function'
          ? selectedUser.displayAvatarURL({ size: 512 })
          : null;
    const profileEmbed = new EmbedBuilder()
      .setColor(0xD4AF37)
      .setTitle('👑 Hollow Kings • Ledenprofiel')
      .setDescription(
        `Het persoonlijke gangprofiel van <@${member.id}>.`,
      )
      .addFields(
        {
          name: '👤 Lid',
          value:
            `**${shorten(member.displayName, 100)}**\n` +
            `<@${member.id}>`,
          inline: true,
        },
        {
          name: '🎖️ Huidige rang',
          value: currentRank
            ? `<@&${currentRank.id}>`
            : 'Onbekend',
          inline: true,
        },
        {
          name: '📊 Puntenpositie',
          value: pointsPosition
            ? `**#${pointsPosition}** van ` +
              `**${rankedMembers.length}** gangleden`
            : 'Nog niet geplaatst',
          inline: true,
        },
        {
          name: '⭐ Puntenvoortgang',
          value: pointsStoreReady
            ? buildPointsProgress(points)
            : 'De puntenopslag is momenteel niet beschikbaar.',
        },
        {
          name: '🏷️ Hollow Kings-rollen',
          value: rankRoles.length
            ? rankRoles
                .map(role => `<@&${role.id}>`)
                .join(' • ')
            : 'Geen ingestelde Hollow Kings-rollen',
        },
        {
          name: '📅 Lid van de server sinds',
          value: joinedTimestamp
            ? `<t:${joinedTimestamp}:D>\n<t:${joinedTimestamp}:R>`
            : 'Datum niet beschikbaar',
          inline: true,
        },
        {
          name: '🪪 Discord-account sinds',
          value: accountTimestamp
            ? `<t:${accountTimestamp}:D>\n` +
              `<t:${accountTimestamp}:R>`
            : 'Datum niet beschikbaar',
          inline: true,
        },
        {
          name: '📍 Huidige status',
          value: getMemberProfileAbsence(
            guild.id,
            member.id,
          ),
          inline: true,
        },
      )
      .setFooter({
        text:
          `Profiel opgevraagd door ` +
          `${interaction.user.tag ?? interaction.user.username}`,
      })
      .setTimestamp();

    if (avatarUrl) {
      profileEmbed.setThumbnail(avatarUrl);
    } else if (guild.iconURL?.({ size: 256 })) {
      profileEmbed.setThumbnail(guild.iconURL({ size: 256 }));
    }

    await interaction.editReply({
      embeds: [profileEmbed],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error('/profiel-fout:', error);
    await interaction.editReply(
      'Ik kon het ledenprofiel niet ophalen. Controleer Server ' +
      'Members Intent en probeer het opnieuw.',
    );
  }
});

function memberCanSubmitPoints(interaction) {
  return (
    memberHasGangRole(interaction.member) ||
    interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    ) === true
  );
}

async function getPointsSourceChannel(guild) {
  if (!POINTS_SOURCE_CHANNEL_ID) return null;

  const channel =
    guild.channels.cache.get(POINTS_SOURCE_CHANNEL_ID) ??
    (await guild.channels
      .fetch(POINTS_SOURCE_CHANNEL_ID)
      .catch(() => null));

  return channel && typeof channel.send === 'function'
    ? channel
    : null;
}

function parsePointsSubmissionUrl(value) {
  try {
    const url = new URL(String(value ?? '').trim());

    return ['http:', 'https:'].includes(url.protocol)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function canMentionPointsSubmissionRole(guild, channel, role) {
  if (role?.mentionable) return true;

  return channel.permissionsFor?.(guild.members.me)?.has(
    PermissionFlagsBits.MentionEveryone,
  ) === true;
}

// /puntenindienen: een ganglid kiest eerst het soort activiteit.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'puntenindienen' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (!memberCanSubmitPoints(interaction)) {
    await interaction.reply({
      content:
        'Alleen gangleden met een ingestelde rangrol en serverbeheer ' +
        'mogen punten indienen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!pointsStoreReady) {
    await interaction.reply({
      content:
        'De puntenopslag is niet beschikbaar. Controleer de ' +
        'Railway-logs.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!POINTS_SOURCE_CHANNEL_ID) {
    await interaction.reply({
      content:
        'POINTS_SOURCE_CHANNEL_ID is nog niet ingesteld in Railway.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const typeSelect = new StringSelectMenuBuilder()
    .setCustomId(`points-submit:type:${interaction.user.id}`)
    .setPlaceholder('Kies het soort activiteit')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      ...POINTS_ACTIVITY_TYPE_KEYS.map(type => {
        const details = POINTS_SUBMISSION_TYPES[type];
        return {
          label: details.label,
          value: type,
          emoji: details.emoji,
          description: `Dien punten voor ${details.label} in`,
        };
      }),
    );

  await interaction.reply({
    content:
      '**Punten indienen**\nKies eerst om welk soort activiteit het gaat.',
    components: [
      new ActionRowBuilder().addComponents(typeSelect),
    ],
    flags: MessageFlags.Ephemeral,
  });
});

// Na iedere selectie verschijnt hetzelfde gekoppelde puntenformulier.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isStringSelectMenu() ||
    !interaction.customId.startsWith('points-submit:type:') ||
    !interaction.inGuild()
  ) {
    return;
  }

  const ownerId = interaction.customId.slice(
    'points-submit:type:'.length,
  );
  const type = interaction.values[0];
  const typeDetails = POINTS_SUBMISSION_TYPES[type];

  if (ownerId !== interaction.user.id || !typeDetails) {
    await interaction.reply({
      content:
        'Deze puntenselectie hoort niet bij jou of is verlopen. ' +
        'Gebruik `/puntenindienen` opnieuw.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!memberCanSubmitPoints(interaction)) {
    await interaction.reply({
      content: 'Je mag geen punten meer indienen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(
      `points-submit:form:${type}:${interaction.user.id}`,
    )
    .setTitle(`Punten indienen • ${typeDetails.label}`);
  const pointsInput = new TextInputBuilder()
    .setCustomId('points_submit_points')
    .setPlaceholder('Bijvoorbeeld: 2')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(4);
  const multiInput = new TextInputBuilder()
    .setCustomId('points_submit_multi')
    .setPlaceholder('Bijvoorbeeld: x2, 2 man of geen')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(100);
  const clipInput = new TextInputBuilder()
    .setCustomId('points_submit_clip')
    .setPlaceholder('https://medal.tv/...')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(8)
    .setMaxLength(1000);
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('points_submit_role')
    .setPlaceholder('Kies de rol die gepingd moet worden')
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1);

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Punten')
      .setDescription('Hoeveel punten levert deze activiteit op?')
      .setTextInputComponent(pointsInput),
    new LabelBuilder()
      .setLabel('Multi')
      .setDescription('Vul de bijbehorende multi-informatie in')
      .setTextInputComponent(multiInput),
    new LabelBuilder()
      .setLabel('Clip Link')
      .setDescription('Vul een volledige http- of https-link in')
      .setTextInputComponent(clipInput),
    new LabelBuilder()
      .setLabel('Welke rol moet getagd worden?')
      .setDescription('Deze rol krijgt een echte Discord-melding')
      .setRoleSelectMenuComponent(roleSelect),
  );

  await interaction.showModal(modal);
});

// Het ingevulde formulier wordt in het puntenkanaal geplaatst en opgeslagen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isModalSubmit() ||
    !interaction.customId.startsWith('points-submit:form:') ||
    !interaction.inGuild()
  ) {
    return;
  }

  const customIdParts = interaction.customId.split(':');
  const type = customIdParts[2];
  const ownerId = customIdParts[3];
  const typeDetails = POINTS_SUBMISSION_TYPES[type];

  if (ownerId !== interaction.user.id || !typeDetails) {
    await interaction.reply({
      content:
        'Dit puntenformulier hoort niet bij jou of is verlopen. ' +
        'Gebruik `/puntenindienen` opnieuw.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!memberCanSubmitPoints(interaction)) {
    await interaction.reply({
      content: 'Je mag geen punten meer indienen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  if (!pointsStoreReady) {
    await interaction.editReply(
      'De puntenopslag is niet beschikbaar. Controleer de Railway-logs.',
    );
    return;
  }

  const pointsText = interaction.fields
    .getTextInputValue('points_submit_points')
    .trim();
  const points = Number.parseInt(pointsText, 10);
  const multi = interaction.fields
    .getTextInputValue('points_submit_multi')
    .trim();
  const clipLink = parsePointsSubmissionUrl(
    interaction.fields.getTextInputValue('points_submit_clip'),
  );
  const selectedRoles = interaction.fields.getSelectedRoles(
    'points_submit_role',
    true,
  );
  const role = selectedRoles.first();

  if (!/^\d{1,4}$/.test(pointsText) || points < 1 || points > 9999) {
    await interaction.editReply(
      'Vul bij Punten een heel getal van 1 tot en met 9999 in.',
    );
    return;
  }

  if (!multi) {
    await interaction.editReply('Vul geldige informatie bij Multi in.');
    return;
  }

  if (!clipLink) {
    await interaction.editReply(
      'De Clip Link is ongeldig. Gebruik een volledige http- of ' +
      'https-link.',
    );
    return;
  }

  if (!role) {
    await interaction.editReply('Kies een geldige rol om te taggen.');
    return;
  }

  const targetChannel = await getPointsSourceChannel(
    interaction.guild,
  );

  if (!targetChannel) {
    await interaction.editReply(
      'Ik kan het ingestelde puntenkanaal niet vinden of daar niet ' +
      'in versturen.',
    );
    return;
  }

  if (
    !canMentionPointsSubmissionRole(
      interaction.guild,
      targetChannel,
      role,
    )
  ) {
    await interaction.editReply(
      `Ik kan <@&${role.id}> niet echt pingen. Maak de rol ` +
      'vermeldbaar of geef de bot de permissie **Iedereen, @here ' +
      'en alle rollen vermelden**.',
    );
    return;
  }

  const submissionEmbed = new EmbedBuilder()
    .setColor(typeDetails.color)
    .setTitle(
      `${typeDetails.emoji} Punten ingediend • ${typeDetails.label}`,
    )
    .setDescription(
      `Er is een nieuwe **${typeDetails.label.toLowerCase()}** ` +
      'ingediend voor het Hollow Kings-puntensysteem.',
    )
    .addFields(
      {
        name: 'Soort',
        value: `${typeDetails.emoji} ${typeDetails.label}`,
        inline: true,
      },
      {
        name: 'Punten',
        value: `**${points} punten**`,
        inline: true,
      },
      {
        name: 'Multi',
        value: shorten(multi),
        inline: true,
      },
      {
        name: 'Clip Link',
        value: `[Bekijk de clip](${clipLink})`,
      },
      {
        name: 'Getagde rol',
        value: `<@&${role.id}>`,
        inline: true,
      },
      {
        name: 'Ingediend door',
        value: `<@${interaction.user.id}>`,
        inline: true,
      },
    )
    .setFooter({
      text: 'Reageer met groen of rood om de punten te ontvangen',
    })
    .setTimestamp();

  try {
    const sentMessage = await targetChannel.send({
      content:
        `<@&${role.id}>\n` +
        `**${typeDetails.label}**\n` +
        `${points} punten`,
      embeds: [submissionEmbed],
      allowedMentions: {
        parse: [],
        roles: [role.id],
      },
    });

    const missingReactions = [];

    for (const emoji of ['🟢', '🔴']) {
      try {
        await sentMessage.react(emoji);
      } catch {
        missingReactions.push(emoji);
      }
    }

    const activityChanged = syncDailyPointsActivity({
      guildId: interaction.guild.id,
      message: sentMessage,
    });

    if (activityChanged) await queuePointsSave();

    const messageLink =
      `https://discord.com/channels/${interaction.guild.id}/` +
      `${targetChannel.id}/${sentMessage.id}`;
    const logEmbed = makeEmbed(
      'points',
      `${typeDetails.label} via /puntenindienen`,
    ).addFields(
      {
        name: 'Soort',
        value: `${typeDetails.emoji} ${typeDetails.label}`,
        inline: true,
      },
      {
        name: 'Punten',
        value: String(points),
        inline: true,
      },
      {
        name: 'Multi',
        value: shorten(multi),
        inline: true,
      },
      {
        name: 'Clip',
        value: `[Open de clip](${clipLink})`,
      },
      {
        name: 'Getagde rol',
        value: `<@&${role.id}> (${role.id})`,
      },
      {
        name: 'Ingediend door',
        value: formatUser(interaction.user),
      },
      {
        name: 'Puntenbericht',
        value: `[Open het bericht](${messageLink})`,
      },
    );

    await sendLog(interaction.guild, 'points', logEmbed);

    await interaction.editReply(
      `✅ **${typeDetails.label}** is geplaatst in ` +
      `<#${targetChannel.id}> en gekoppeld aan het dagoverzicht, ` +
      'de puntenlijst, losse punten, de puntenreset en de logs.' +
      (missingReactions.length
        ? `\n⚠️ Ik kon ${missingReactions.join(' en ')} niet ` +
          'toevoegen. Geef mij daar de permissie Reacties toevoegen.'
        : ''),
    );
  } catch (error) {
    console.error('/puntenindienen-fout:', error);
    await interaction.editReply(
      'Ik kon de puntenindiening niet plaatsen. Controleer of ik in ' +
      'het puntenkanaal Berichten verzenden, Links insluiten, ' +
      'Reacties toevoegen en rollen vermelden mag.',
    );
  }
});

// /puntenlijst: privé-overzicht voor beheer met alle huidige gangleden.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'puntenlijst' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!pointsStoreReady) {
    await interaction.editReply(
      'De puntenopslag is niet beschikbaar. Controleer de Railway-logs.',
    );
    return;
  }

  try {
    const guild = interaction.guild;
    const members =
      guild.members.cache.size >= guild.memberCount
        ? guild.members.cache
        : await guild.members.fetch();
    const totals = calculatePointsTotals(guild.id);

    const gangMembers = [...members.values()]
      .filter(member =>
        !member.user.bot &&
        memberHasGangRole(member),
      )
      .map(member => ({
        member,
        points: totals.get(member.id) ?? 0,
      }))
      .sort((entryA, entryB) =>
        entryB.points - entryA.points ||
        entryA.member.displayName.localeCompare(
          entryB.member.displayName,
          'nl',
          { sensitivity: 'base' },
        ),
      );

    const totalPoints = gangMembers.reduce(
      (sum, entry) => sum + entry.points,
      0,
    );
    const lines = gangMembers.length
      ? gangMembers.map(
          (entry, index) =>
            `**${index + 1}.** <@${entry.member.id}> — ` +
            `**${entry.points} punten**`,
        )
      : ['*Geen gangleden met een ingestelde rangrol gevonden.*'];

    const pages = [];
    let currentPage = '';

    for (const line of lines) {
      const addition = currentPage ? `\n${line}` : line;

      if (currentPage && currentPage.length + addition.length > 3500) {
        pages.push(currentPage);
        currentPage = line;
      } else {
        currentPage += addition;
      }
    }

    if (currentPage) pages.push(currentPage);

    const summary =
      `**Gangleden:** ${gangMembers.length} • ` +
      `**Totaal verdiend:** ${totalPoints} punten\n` +
      `**Bijgehouden sinds:** ` +
      `<t:${Math.floor(getGuildPointsStartTime(guild.id) / 1000)}:f>`;

    const makePointsListEmbed = (page, pageIndex) =>
      new EmbedBuilder()
        .setColor(COLORS.points)
        .setTitle('Hollow Kings Puntenlijst')
        .setDescription(
          `${pageIndex === 0 ? `${summary}\n\n` : ''}${page}`,
        )
        .setFooter({
          text: `Pagina ${pageIndex + 1} van ${pages.length}`,
        })
        .setTimestamp();

    await interaction.editReply({
      embeds: [makePointsListEmbed(pages[0], 0)],
      allowedMentions: { parse: [] },
    });

    for (const [pageIndex, page] of pages.slice(1).entries()) {
      await interaction.followUp({
        embeds: [makePointsListEmbed(page, pageIndex + 1)],
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error('/puntenlijst-fout:', error);
    await interaction.editReply(
      'Ik kon de puntenlijst niet ophalen. Controleer Server Members Intent.',
    );
  }
});

// /puntenvandaag: beheer plaatst een openbare daglijst voor iedereen.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'puntenvandaag' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  if (!pointsStoreReady) {
    await interaction.editReply(
      'De puntenopslag is niet beschikbaar. Controleer de Railway-logs.',
    );
    return;
  }

  try {
    const guild = interaction.guild;
    const now = Date.now();
    const ensured = ensureDailyPointsRecord(
      guild.id,
      now,
      { markBackfillCompleted: true },
    );
    if (ensured.changed) await queuePointsSave();

    const activitySummary =
      summarizeDailyPointsActivities(guild.id, now);
    const nextResetAt = getNextPointsDayStart(now);
    const activityFields = POINTS_ACTIVITY_TYPE_KEYS.map(type => {
      const details = POINTS_SUBMISSION_TYPES[type];
      return {
        name: `${details.emoji} ${details.todayLabel}`,
        value:
          `**${activitySummary[type].count} gedaan**\n` +
          `**${activitySummary[type].points} punten**`,
        inline: true,
      };
    });
    const todayEmbed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('📅 Hollow Kings • Activiteiten vandaag')
      .setDescription(
        `## ${POINTS_ACTIVITY_TYPE_KEYS
          .map(type => POINTS_SUBMISSION_TYPES[type].emoji)
          .join('')} Dagoverzicht\n` +
        `**Datum:** ` +
        `${pointsDisplayDateFormatter.format(new Date(now))}\n\n` +
        'Iedere puntenindiening telt één keer, ongeacht ' +
        'hoeveel leden de punten ontvangen.',
      )
      .addFields(
        ...activityFields,
        {
          name: '📊 Totaal',
          value:
            `**${activitySummary.totalCount} activiteiten**\n` +
            `**${activitySummary.totalPoints} punten**`,
          inline: true,
        },
        {
          name: '🕛 Volgende automatische reset',
          value:
            `<t:${Math.floor(nextResetAt / 1000)}:F> ` +
            `(<t:${Math.floor(nextResetAt / 1000)}:R>)`,
        },
      )
      .setFooter({
        text: 'Reset dagelijks om 00:00 • Nederlandse tijd',
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [todayEmbed],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error('/puntenvandaag-fout:', error);
    await interaction.editReply(
      'Ik kon het activiteitenoverzicht niet ophalen.',
    );
  }
});

// /punten: beheer kan losse punten toevoegen of aftrekken.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'punten' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  if (!pointsStoreReady) {
    await interaction.editReply(
      'De puntenopslag is niet beschikbaar. Controleer de Railway-logs.',
    );
    return;
  }

  const targetUser =
    interaction.options.getUser('lid', true);
  const action =
    interaction.options.getString('actie', true);
  const amount =
    interaction.options.getInteger('aantal', true);
  const reason =
    interaction.options.getString('reden')?.trim() ||
    'Geen reden opgegeven';

  try {
    const targetMember =
      interaction.guild.members.cache.get(targetUser.id) ??
      (await interaction.guild.members
        .fetch(targetUser.id)
        .catch(() => null));

    if (
      !targetMember ||
      targetUser.bot ||
      !memberHasGangRole(targetMember)
    ) {
      await interaction.editReply(
        'Je kunt alleen punten wijzigen van een niet-bot met een ' +
        'ingestelde gangrol.',
      );
      return;
    }

    const result = await changeManualPoints({
      guildId: interaction.guild.id,
      userId: targetUser.id,
      action,
      amount,
      changedBy: interaction.user.id,
      reason,
      eventId:
        interaction.id ??
        `punten-${interaction.guild.id}-${Date.now()}-${randomUUID()}`,
    });
    let achievementResult = null;

    if (
      action === 'toevoegen' &&
      result.newTotal >= POINTS_FIRST_ACHIEVEMENT
    ) {
      achievementResult =
        await maybeSendPointsAchievement({
          guild: interaction.guild,
          user: targetUser,
          totalPoints: result.newTotal,
        }).catch(error => {
          console.error(
            'Puntenmijlpaal na /punten mislukt:',
            error.message,
          );
          return null;
        });
    }

    const added = action === 'toevoegen';
    const responseEmbed = new EmbedBuilder()
      .setColor(added ? 0x57F287 : 0xED4245)
      .setTitle(
        added
          ? '✅ Losse punten toegevoegd'
          : '➖ Losse punten afgetrokken',
      )
      .addFields(
        {
          name: 'Lid',
          value: formatUser(targetUser),
        },
        {
          name: 'Wijziging',
          value:
            `${added ? '+' : '-'}${amount} punten`,
          inline: true,
        },
        {
          name: 'Oud totaal',
          value: `${result.previousTotal} punten`,
          inline: true,
        },
        {
          name: 'Nieuw totaal',
          value: `**${result.newTotal} punten**`,
          inline: true,
        },
        {
          name: 'Reden',
          value: shorten(reason),
        },
        {
          name: 'Uitgevoerd door',
          value: formatUser(interaction.user),
        },
      )
      .setTimestamp();

    if (achievementResult?.milestones.length) {
      const milestoneLabels =
        achievementResult.milestones
          .map(milestone => `${milestone.threshold} punten`)
          .join(', ');

      responseEmbed.addFields({
        name: 'Puntenmijlpaal',
        value:
          `De melding voor **${milestoneLabels}** is ook verstuurd.`,
      });
    }

    await interaction.editReply({
      embeds: [responseEmbed],
      allowedMentions: { parse: [] },
    });

    const logEmbed = makeEmbed(
      'pointsActivity',
      added
        ? 'Losse punten toegevoegd'
        : 'Losse punten afgetrokken',
    ).addFields(
      {
        name: 'Lid',
        value: formatUser(targetUser),
      },
      {
        name: 'Wijziging',
        value: `${added ? '+' : '-'}${amount} punten`,
      },
      {
        name: 'Oud → nieuw',
        value:
          `${result.previousTotal} → ${result.newTotal} punten`,
      },
      {
        name: 'Reden',
        value: shorten(reason),
      },
      {
        name: 'Uitgevoerd door',
        value: formatUser(interaction.user),
      },
    );

    await sendLog(
      interaction.guild,
      'pointsActivity',
      logEmbed,
    );
  } catch (error) {
    if (error.code === 'INSUFFICIENT_POINTS') {
      await interaction.editReply(
        `Dat kan niet: ${targetUser.username} heeft maar ` +
        `${error.availablePoints} punten.`,
      );
      return;
    }

    if (error.code === 'POINTS_UPDATE_BUSY') {
      await interaction.editReply(
        'Voor dit lid wordt al een puntenwijziging verwerkt. ' +
        'Probeer het zo opnieuw.',
      );
      return;
    }

    console.error('/punten-fout:', error);
    await interaction.editReply(
      'De losse punten konden niet veilig worden opgeslagen. ' +
      'Controleer de Railway-logs.',
    );
  }
});

// /puntenreset: beheerreset met verplichte keuze en automatische back-up.
client.on(Events.InteractionCreate, async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'puntenreset' ||
    !interaction.inGuild()
  ) {
    return;
  }

  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: 'Je hebt de permissie Server beheren nodig.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const confirmation =
    interaction.options.getString('bevestiging', true);

  if (confirmation !== 'RESET_ALLES') {
    await interaction.reply({
      content: 'De puntenreset is niet bevestigd.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!pointsStoreReady) {
    await interaction.editReply(
      'De puntenopslag is niet beschikbaar. Controleer de Railway-logs.',
    );
    return;
  }

  try {
    const result = await resetGuildPoints(
      interaction.guild.id,
      interaction.user.id,
    );
    let achievementCleanup;

    try {
      achievementCleanup =
        await clearPointsAchievementChannel(
          interaction.guild,
        );
    } catch (error) {
      console.error(
        'Punten-behaald-kanaal wissen mislukt:',
        error.message,
      );
      achievementCleanup = {
        status: 'failed',
        deleted: 0,
        failed: result.achievementCount,
      };
    }

    const backupText = result.backupCreated
      ? ' Er is eerst automatisch een back-up gemaakt.'
      : ' Er waren nog geen opgeslagen punten of prestaties om ' +
        'te back-uppen.';
    const achievementCleanupText =
      achievementCleanup.status === 'cleared'
        ? ` ${achievementCleanup.deleted} melding(en) uit ` +
          `punten-behaald zijn verwijderd.`
        : achievementCleanup.status === 'partial'
          ? ` ${achievementCleanup.deleted} melding(en) zijn ` +
            `verwijderd; ${achievementCleanup.failed} konden niet ` +
            `worden gewist.`
          : achievementCleanup.status === 'not-configured'
            ? ' Het punten-behaald-kanaal is nog niet ingesteld.'
            : ' Het punten-behaald-kanaal kon niet worden gewist; ' +
              'controleer de kanaalpermissies.';

    await interaction.editReply(
      `De puntenlijst is gereset. ` +
      `${result.participantCount} leden en ${result.totalPoints} punten ` +
      `zijn uit het actieve overzicht verwijderd. ` +
      `Het dagoverzicht met ${result.dailyActivityCount} ` +
      `activiteit(en) en ` +
      `${result.dailyActivityPoints} punten ` +
      `is ook gewist. ` +
      `${result.manualAdjustmentCount} losse puntenaanpassing(en) ` +
      `zijn gereset.${backupText}` +
      `${achievementCleanupText}`,
    );

    const logEmbed = makeEmbed('server', '/puntenreset gebruikt')
      .addFields(
        { name: 'Gebruiker', value: formatUser(interaction.user) },
        {
          name: 'Verwijderde puntenberichten',
          value: String(result.messageCount),
        },
        {
          name: 'Getelde leden',
          value: String(result.participantCount),
        },
        {
          name: 'Verwijderde punten',
          value: String(result.totalPoints),
        },
        {
          name: 'Dagactiviteiten gereset',
          value: shorten(
            POINTS_ACTIVITY_TYPE_KEYS
              .map(type => {
                const details = POINTS_SUBMISSION_TYPES[type];
                const saved =
                  result.dailyActivityBreakdown[type];
                return (
                  `${details.emoji} ${details.todayLabel}: ` +
                  `${saved.count} (${saved.points} punten)`
                );
              })
              .join('\n') +
              `\n**Totaal: ${result.dailyActivityPoints} punten**`,
            1024,
          ),
        },
        {
          name: 'Losse aanpassingen gereset',
          value: String(result.manualAdjustmentCount),
        },
        {
          name: 'Back-up gemaakt',
          value: result.backupCreated ? 'Ja' : 'Niet nodig',
        },
        {
          name: 'Puntenmijlpalen gereset',
          value: String(result.achievementCount),
        },
        {
          name: 'Prestatiemeldingen verwijderd',
          value:
            `${achievementCleanup.deleted} verwijderd, ` +
            `${achievementCleanup.failed} mislukt`,
        },
      );

    await sendLog(interaction.guild, 'server', logEmbed);
  } catch (error) {
    console.error('/puntenreset-fout:', error);
    await interaction.editReply(
      'De puntenlijst kon niet veilig worden gereset. ' +
      'Er zijn geen gegevens bewust verwijderd zonder back-up.',
    );
  }
});

// Ieder nieuw bericht uit het puntenkanaal naar het puntenlogkanaal.
client.on(Events.MessageCreate, async message => {
  if (
    !message.guild ||
    !POINTS_SOURCE_CHANNEL_ID ||
    message.channelId !== POINTS_SOURCE_CHANNEL_ID ||
    message.author?.id === client.user?.id
  ) {
    return;
  }

  if (pointsStoreReady) {
    const activityChanged = syncDailyPointsActivity({
      guildId: message.guild.id,
      message,
    });

    if (activityChanged) {
      await queuePointsSave().catch(error => {
        console.error(
          'Puntenactiviteit opslaan mislukt:',
          error.message,
        );
      });
    }
  }

  const attachments = message.attachments?.size
    ? message.attachments.map(file => file.url).join('\n')
    : 'Geen';

  const embed = makeEmbed('points', 'Nieuw bericht in puntenkanaal')
    .addFields(
      { name: 'Auteur', value: formatUser(message.author) },
      { name: 'Bronkanaal', value: `<#${message.channelId}>` },
      {
        name: 'Inhoud',
        value: shorten(message.content || '*Geen tekst*'),
      },
      { name: 'Bijlagen', value: shorten(attachments) },
      { name: 'Bericht-ID', value: message.id },
    );

  await sendLog(message.guild, 'points', embed);
});

async function resolvePointsReaction(reaction, user) {
  if (!pointsStoreReady || !POINTS_SOURCE_CHANNEL_ID) return null;

  const completeReaction = await fetchCompleteReaction(reaction);
  const message = completeReaction.message.partial
    ? await completeReaction.message.fetch()
    : completeReaction.message;
  const completeUser = user.partial ? await user.fetch() : user;
  const emoji = completeReaction.emoji.name;

  if (
    !message.guild ||
    message.channelId !== POINTS_SOURCE_CHANNEL_ID ||
    message.createdTimestamp <
      getGuildPointsStartTime(message.guild.id) ||
    completeUser.bot ||
    !POINT_REACTION_EMOJIS.has(emoji)
  ) {
    return null;
  }

  return {
    emoji,
    message,
    user: completeUser,
  };
}

// Zowel 🟢 als 🔴 geeft het puntenaantal uit het bericht, maximaal één keer.
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    const context = await resolvePointsReaction(reaction, user);
    if (!context) return;

    const { emoji, message, user: completeUser } = context;
    const points = parsePointsFromMessage(message.content);
    if (!points) return;

    const member =
      message.guild.members.cache.get(completeUser.id) ??
      (await message.guild.members
        .fetch(completeUser.id)
        .catch(() => null));

    if (!member || !memberHasGangRole(member)) return;

    const entry =
      getPointsEntry(message.id) ??
      {
        guildId: message.guild.id,
        channelId: message.channelId,
        points,
        users: {},
        messageCreatedAt: message.createdTimestamp,
        updatedAt: new Date().toISOString(),
      };
    let changed = false;

    if (entry.points !== points) {
      entry.points = points;
      changed = true;
    }

    const reactions = new Set(entry.users?.[completeUser.id] ?? []);
    const alreadyHadPoints = reactions.size > 0;

    if (!reactions.has(emoji)) {
      reactions.add(emoji);
      entry.users ??= {};
      entry.users[completeUser.id] = [...reactions];
      changed = true;
    }

    if (!getPointsEntry(message.id)) {
      pointsData.messages[message.id] = entry;
      changed = true;
    }

    if (!changed) return;

    entry.messageCreatedAt ??= message.createdTimestamp;

    if (!alreadyHadPoints) {
      setDailyReactionAward({
        guildId: message.guild.id,
        messageId: message.id,
        userId: completeUser.id,
        points,
      });
    }

    syncDailyPointsActivity({
      guildId: message.guild.id,
      message,
    });

    entry.updatedAt = new Date().toISOString();
    await queuePointsSave();

    if (!alreadyHadPoints) {
      await sendPointsActivityLog({
        guild: message.guild,
        user: completeUser,
        message,
        pointsChange: points,
        emoji,
      });

      const newTotal =
        calculatePointsTotals(message.guild.id)
          .get(completeUser.id) ?? 0;

      await maybeSendPointsAchievement({
        guild: message.guild,
        user: completeUser,
        totalPoints: newTotal,
      }).catch(error => {
        console.error(
          'Puntenmijlpaal versturen mislukt:',
          error.message,
        );
      });
    }
  } catch (error) {
    console.error('Puntenreactie toevoegen mislukt:', error.message);
  }
});

// Een lid behoudt de punten zolang 🟢 of 🔴 nog op het bericht staat.
client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    if (!pointsStoreReady || !POINTS_SOURCE_CHANNEL_ID || user.bot) return;

    const completeReaction = await fetchCompleteReaction(reaction);
    const message = completeReaction.message;
    const completeUser = user.partial
      ? await user.fetch().catch(() => user)
      : user;
    const emoji = completeReaction.emoji.name;
    const entry = getPointsEntry(message.id);

    if (
      !entry ||
      message.channelId !== POINTS_SOURCE_CHANNEL_ID ||
      !POINT_REACTION_EMOJIS.has(emoji)
    ) {
      return;
    }

    const reactions = new Set(entry.users?.[completeUser.id] ?? []);
    if (!reactions.delete(emoji)) return;
    const lostPoints = reactions.size === 0;

    if (reactions.size) {
      entry.users[completeUser.id] = [...reactions];
    } else {
      delete entry.users[completeUser.id];
    }

    if (lostPoints) {
      removeDailyReactionAward({
        guildId: message.guild.id,
        messageId: message.id,
        userId: completeUser.id,
      });
    }

    entry.updatedAt = new Date().toISOString();
    removeEmptyPointsEntry(message.id);
    await queuePointsSave();

    if (lostPoints) {
      await sendPointsActivityLog({
        guild: message.guild,
        user: completeUser,
        message,
        pointsChange: -entry.points,
        emoji,
      });
    }
  } catch (error) {
    console.error('Puntenreactie verwijderen mislukt:', error.message);
  }
});

// Wanneer alle reacties worden gewist, worden alle punten van dit bericht gewist.
client.on(Events.MessageReactionRemoveAll, async message => {
  if (
    !pointsStoreReady ||
    message.channelId !== POINTS_SOURCE_CHANNEL_ID ||
    !getPointsEntry(message.id)
  ) {
    return;
  }

  const entry = getPointsEntry(message.id);
  removeDailyReactionAwardsForMessage({
    guildId: message.guild?.id ?? entry.guildId,
    messageId: message.id,
  });
  delete pointsData.messages[message.id];
  await queuePointsSave().catch(error => {
    console.error('Punten na reactie-reset opslaan mislukt:', error.message);
  });
});

// Wanneer één emoji overal wordt verwijderd, blijft de andere kleur meetellen.
client.on(Events.MessageReactionRemoveEmoji, async reaction => {
  try {
    if (!pointsStoreReady) return;

    const completeReaction = await fetchCompleteReaction(reaction);
    const message = completeReaction.message;
    const emoji = completeReaction.emoji.name;
    const entry = getPointsEntry(message.id);

    if (
      !entry ||
      message.channelId !== POINTS_SOURCE_CHANNEL_ID ||
      !POINT_REACTION_EMOJIS.has(emoji)
    ) {
      return;
    }

    let changed = false;
    const lostUserIds = [];

    for (const [userId, savedReactions] of Object.entries(entry.users)) {
      const reactions = new Set(savedReactions);

      if (reactions.delete(emoji)) {
        changed = true;
      }

      if (reactions.size) {
        entry.users[userId] = [...reactions];
      } else {
        delete entry.users[userId];
        lostUserIds.push(userId);
      }
    }

    if (!changed) return;

    for (const userId of lostUserIds) {
      removeDailyReactionAward({
        guildId: entry.guildId,
        messageId: message.id,
        userId,
      });
    }

    entry.updatedAt = new Date().toISOString();
    removeEmptyPointsEntry(message.id);
    await queuePointsSave();
  } catch (error) {
    console.error('Puntenemoji verwijderen mislukt:', error.message);
  }
});

// Een aangepast puntenaantal werkt alle deelnemers van dat bericht bij.
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  try {
    if (
      !pointsStoreReady ||
      newMessage.channelId !== POINTS_SOURCE_CHANNEL_ID
    ) {
      return;
    }

    const completeMessage = newMessage.partial
      ? await newMessage.fetch()
      : newMessage;
    const guildId =
      completeMessage.guild?.id ??
      getPointsEntry(completeMessage.id)?.guildId;

    if (!guildId) return;

    const activityChanged = syncDailyPointsActivity({
      guildId,
      message: completeMessage,
    });
    const entry = getPointsEntry(completeMessage.id);

    if (!entry) {
      if (activityChanged) await queuePointsSave();
      return;
    }

    const points = parsePointsFromMessage(completeMessage.content);
    let pointsChanged = false;

    if (!points) {
      removeDailyReactionAwardsForMessage({
        guildId: entry.guildId,
        messageId: completeMessage.id,
      });
      delete pointsData.messages[completeMessage.id];
      pointsChanged = true;
    } else if (entry.points !== points) {
      entry.points = points;
      updateDailyReactionAwardsForMessage({
        guildId: entry.guildId,
        messageId: completeMessage.id,
        points,
      });
      entry.updatedAt = new Date().toISOString();
      pointsChanged = true;
    }

    if (!pointsChanged && !activityChanged) {
      return;
    }

    await queuePointsSave();
  } catch (error) {
    console.error('Aangepaste punten opslaan mislukt:', error.message);
  }
});

// Een verwijderd puntenbericht trekt de bijbehorende punten automatisch af.
client.on(Events.MessageDelete, async message => {
  if (
    !pointsStoreReady ||
    message.channelId !== POINTS_SOURCE_CHANNEL_ID
  ) {
    return;
  }

  const entry = getPointsEntry(message.id);
  const guildId = message.guild?.id ?? entry?.guildId;
  if (!guildId) return;

  let changed = removeDailyPointsActivity({
    guildId,
    messageId: message.id,
  });

  if (entry) {
    removeDailyReactionAwardsForMessage({
      guildId,
      messageId: message.id,
    });
    delete pointsData.messages[message.id];
    changed = true;
  }

  if (!changed) return;

  await queuePointsSave().catch(error => {
    console.error('Verwijderde punten opslaan mislukt:', error.message);
  });
});

client.on(Events.MessageBulkDelete, async (messages, channel) => {
  if (
    !pointsStoreReady ||
    channel.id !== POINTS_SOURCE_CHANNEL_ID
  ) {
    return;
  }

  let changed = false;

  for (const messageId of messages.keys()) {
    const entry = getPointsEntry(messageId);
    const guildId = channel.guild?.id ?? entry?.guildId;

    if (
      guildId &&
      removeDailyPointsActivity({
        guildId,
        messageId,
      })
    ) {
      changed = true;
    }

    if (entry) {
      removeDailyReactionAwardsForMessage({
        guildId,
        messageId,
      });
      delete pointsData.messages[messageId];
      changed = true;
    }
  }

  if (changed) {
    await queuePointsSave().catch(error => {
      console.error('Bulkverwijderde punten opslaan mislukt:', error.message);
    });
  }
});

// Bericht verwijderd
client.on(Events.MessageDelete, async message => {
  if (!message.guild || message.author?.id === client.user?.id) return;

  const isPointsMessage =
    POINTS_SOURCE_CHANNEL_ID &&
    message.channelId === POINTS_SOURCE_CHANNEL_ID;

  if (message.author?.bot && !isPointsMessage) return;

  const category = isPointsMessage ? 'points' : 'messages';

  const attachments = message.attachments?.size
    ? message.attachments.map(file => file.url).join('\n')
    : 'Geen';

  const embed = makeEmbed(
    category,
    isPointsMessage ? 'Puntenbericht verwijderd' : 'Bericht verwijderd',
  )
    .addFields(
      { name: 'Auteur', value: formatUser(message.author) },
      { name: 'Kanaal', value: `<#${message.channelId}>` },
      {
        name: 'Inhoud',
        value: shorten(message.content || '*Niet beschikbaar*'),
      },
      { name: 'Bijlagen', value: shorten(attachments) },
    );

  await sendLog(message.guild, category, embed);
});

// Bericht aangepast
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.id === client.user?.id) return;

  const isPointsMessage =
    POINTS_SOURCE_CHANNEL_ID &&
    newMessage.channelId === POINTS_SOURCE_CHANNEL_ID;

  if (newMessage.author?.bot && !isPointsMessage) return;

  const before = oldMessage.content ?? '*Niet beschikbaar*';
  const after = newMessage.content ?? '*Niet beschikbaar*';
  if (before === after) return;

  const category = isPointsMessage ? 'points' : 'messages';
  const embed = makeEmbed(
    category,
    isPointsMessage ? 'Puntenbericht aangepast' : 'Bericht aangepast',
  )
    .addFields(
      { name: 'Auteur', value: formatUser(newMessage.author) },
      { name: 'Kanaal', value: `<#${newMessage.channelId}>` },
      { name: 'Voor', value: shorten(before) },
      { name: 'Na', value: shorten(after) },
    );

  await sendLog(newMessage.guild, category, embed);
});

// Meerdere berichten tegelijk verwijderd
client.on(Events.MessageBulkDelete, async (messages, channel) => {
  if (!channel.guild) return;

  const isPointsChannel =
    POINTS_SOURCE_CHANNEL_ID &&
    channel.id === POINTS_SOURCE_CHANNEL_ID;
  const category = isPointsChannel ? 'points' : 'messages';

  const authors = [
    ...new Set(messages.map(message => message.author?.tag).filter(Boolean)),
  ].slice(0, 10).join(', ') || 'Onbekend';

  const embed = makeEmbed(
    category,
    isPointsChannel
      ? 'Puntenberichten in bulk verwijderd'
      : 'Berichten in bulk verwijderd',
  )
    .addFields(
      { name: 'Aantal', value: String(messages.size) },
      { name: 'Kanaal', value: `<#${channel.id}>` },
      { name: 'Bekende auteurs', value: shorten(authors) },
    );

  await sendLog(channel.guild, category, embed);
});

// Lid binnengekomen
client.on(Events.GuildMemberAdd, async member => {
  const embed = makeEmbed('members', 'Lid binnengekomen')
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'Gebruiker', value: formatUser(member.user) },
      {
        name: 'Account gemaakt',
        value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
      },
    );

  await sendLog(member.guild, 'members', embed);
});

// Lid heeft de server verlaten, is gekickt of is verbannen.
// Een kick of ban verschijnt ook met uitvoerder in het moderatiekanaal.
client.on(Events.GuildMemberRemove, async member => {
  const embed = makeEmbed('members', 'Lid niet meer in de server')
    .setThumbnail(member.user.displayAvatarURL())
    .addFields({ name: 'Gebruiker', value: formatUser(member.user) });

  await sendLog(member.guild, 'members', embed);
});

// Voice join, leave, move en server mute/deafen
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  let title;
  let description;

  if (!oldState.channelId && newState.channelId) {
    title = 'Voice binnengekomen';
    description = `${formatUser(member.user)} kwam in ${newState.channel.name}.`;
  } else if (oldState.channelId && !newState.channelId) {
    title = 'Voice verlaten';
    description = `${formatUser(member.user)} verliet ${oldState.channel.name}.`;
  } else if (
    oldState.channelId &&
    newState.channelId &&
    oldState.channelId !== newState.channelId
  ) {
    title = 'Voice verplaatst';
    description =
      `${formatUser(member.user)} ging van ${oldState.channel.name} ` +
      `naar ${newState.channel.name}.`;
  } else if (oldState.serverMute !== newState.serverMute) {
    title = newState.serverMute ? 'Server mute gegeven' : 'Server mute verwijderd';
    description = formatUser(member.user);
  } else if (oldState.serverDeaf !== newState.serverDeaf) {
    title = newState.serverDeaf
      ? 'Server deaf gegeven'
      : 'Server deaf verwijderd';
    description = formatUser(member.user);
  } else {
    return;
  }

  const embed = makeEmbed('voice', title)
    .setDescription(shorten(description, 4096));

  await sendLog(newState.guild, 'voice', embed);
});

const AUDIT_ROUTES = new Map([
  [AuditLogEvent.MemberKick, ['moderation', 'Lid gekickt']],
  [AuditLogEvent.MemberBanAdd, ['moderation', 'Lid verbannen']],
  [AuditLogEvent.MemberBanRemove, ['moderation', 'Ban opgeheven']],
  [AuditLogEvent.MemberPrune, ['moderation', 'Inactieve leden verwijderd']],
  [AuditLogEvent.MemberUpdate, ['moderation', 'Lid aangepast / timeout']],
  [AuditLogEvent.AutoModerationBlockMessage, ['moderation', 'AutoMod blokkeerde bericht']],
  [AuditLogEvent.AutoModerationFlagToChannel, ['moderation', 'AutoMod markeerde bericht']],
  [AuditLogEvent.AutoModerationQuarantineUser, ['moderation', 'AutoMod plaatste gebruiker in quarantaine']],
  [AuditLogEvent.AutoModerationUserCommunicationDisabled, ['moderation', 'AutoMod gaf timeout']],
  [AuditLogEvent.AutoModerationRuleCreate, ['moderation', 'AutoMod-regel gemaakt']],
  [AuditLogEvent.AutoModerationRuleUpdate, ['moderation', 'AutoMod-regel aangepast']],
  [AuditLogEvent.AutoModerationRuleDelete, ['moderation', 'AutoMod-regel verwijderd']],

  [AuditLogEvent.MemberRoleUpdate, ['roles', 'Lidrollen aangepast']],
  [AuditLogEvent.RoleCreate, ['roles', 'Rol gemaakt']],
  [AuditLogEvent.RoleUpdate, ['roles', 'Rol aangepast']],
  [AuditLogEvent.RoleDelete, ['roles', 'Rol verwijderd']],

  [AuditLogEvent.MessageDelete, ['messages', 'Bericht door moderator verwijderd']],
  [AuditLogEvent.MessageBulkDelete, ['messages', 'Bulkverwijdering door moderator']],
  [AuditLogEvent.MessagePin, ['messages', 'Bericht vastgezet']],
  [AuditLogEvent.MessageUnpin, ['messages', 'Bericht losgemaakt']],

  [AuditLogEvent.MemberMove, ['voice', 'Lid in voice verplaatst']],
  [AuditLogEvent.MemberDisconnect, ['voice', 'Lid uit voice verwijderd']],

  [AuditLogEvent.GuildUpdate, ['server', 'Serverinstellingen aangepast']],
  [AuditLogEvent.ChannelCreate, ['server', 'Kanaal gemaakt']],
  [AuditLogEvent.ChannelUpdate, ['server', 'Kanaal aangepast']],
  [AuditLogEvent.ChannelDelete, ['server', 'Kanaal verwijderd']],
  [AuditLogEvent.ChannelOverwriteCreate, ['server', 'Kanaalrechten gemaakt']],
  [AuditLogEvent.ChannelOverwriteUpdate, ['server', 'Kanaalrechten aangepast']],
  [AuditLogEvent.ChannelOverwriteDelete, ['server', 'Kanaalrechten verwijderd']],
  [AuditLogEvent.InviteCreate, ['server', 'Uitnodiging gemaakt']],
  [AuditLogEvent.InviteUpdate, ['server', 'Uitnodiging aangepast']],
  [AuditLogEvent.InviteDelete, ['server', 'Uitnodiging verwijderd']],
  [AuditLogEvent.EmojiCreate, ['server', 'Emoji gemaakt']],
  [AuditLogEvent.EmojiUpdate, ['server', 'Emoji aangepast']],
  [AuditLogEvent.EmojiDelete, ['server', 'Emoji verwijderd']],
  [AuditLogEvent.StickerCreate, ['server', 'Sticker gemaakt']],
  [AuditLogEvent.StickerUpdate, ['server', 'Sticker aangepast']],
  [AuditLogEvent.StickerDelete, ['server', 'Sticker verwijderd']],
  [AuditLogEvent.WebhookCreate, ['server', 'Webhook gemaakt']],
  [AuditLogEvent.WebhookUpdate, ['server', 'Webhook aangepast']],
  [AuditLogEvent.WebhookDelete, ['server', 'Webhook verwijderd']],
  [AuditLogEvent.BotAdd, ['server', 'Bot toegevoegd']],
]);

const CHANGE_NAMES = {
  name: 'Naam',
  nick: 'Nickname',
  permissions: 'Permissies',
  color: 'Kleur',
  hoist: 'Apart weergegeven',
  mentionable: 'Vermeldbaar',
  communication_disabled_until: 'Timeout tot',
  $add: 'Toegevoegd',
  $remove: 'Verwijderd',
};

function formatAuditValue(value) {
  if (value === undefined || value === null || value === '') return '—';

  if (Array.isArray(value)) {
    return value.map(item => {
      if (item && typeof item === 'object') {
        return item.name
          ? `${item.name}${item.id ? ` (${item.id})` : ''}`
          : item.id ?? JSON.stringify(item);
      }
      return String(item);
    }).join(', ');
  }

  if (typeof value === 'object') {
    const name = value.name ?? value.tag ?? value.username;
    if (name) return value.id ? `${name} (${value.id})` : String(name);

    try {
      return JSON.stringify(value);
    } catch {
      return '[object]';
    }
  }

  return String(value);
}

function formatChanges(changes) {
  if (!changes?.length) return null;

  const lines = changes.slice(0, 8).map(change => {
    const name = CHANGE_NAMES[change.key] ?? change.key;

    if (change.key === '$add' || change.key === '$remove') {
      return `**${name}:** ${formatAuditValue(change.newValue)}`;
    }

    return (
      `**${name}:** ${formatAuditValue(change.oldValue)} → ` +
      `${formatAuditValue(change.newValue)}`
    );
  });

  return shorten(lines.join('\n'));
}

// Auditlog: wie deed welke staff-, rol- of serveractie?
client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
  const [category, title] =
    AUDIT_ROUTES.get(entry.action) ??
    ['server', `Overige auditactie (${entry.action})`];

  const executor = entry.executorId
    ? await client.users.fetch(entry.executorId).catch(() => null)
    : null;

  const embed = makeEmbed(category, title)
    .addFields(
      { name: 'Uitgevoerd door', value: formatUser(executor) },
      { name: 'Doel', value: formatEntity(entry.target, entry.targetId) },
      {
        name: 'Reden',
        value: shorten(entry.reason || 'Geen reden opgegeven'),
      },
    );

  const changes = formatChanges(entry.changes);
  if (changes) {
    embed.addFields({ name: 'Wijzigingen', value: changes });
  }

  if (
    entry.extra &&
    typeof entry.extra === 'object' &&
    entry.extra.id
  ) {
    embed.addFields({
      name: 'Kanaal / extra',
      value: formatEntity(entry.extra, entry.extra.id),
    });
  }

  await sendLog(guild, category, embed);
});

client.on(Events.Error, error => {
  console.error('Discord-fout:', error);
});

client.login(process.env.DISCORD_TOKEN);
