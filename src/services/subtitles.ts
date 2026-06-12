import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { getDb } from './mongodb.js';

const MILAHU_API_URL = 'http://milahu.duckdns.org/bin/get-subtitles';
const STORAGE_BASE = path.join(process.cwd(), 'data');

export interface SubtitleResult {
  id: string; // The filename or an ID from the source
  language: string;
  format: string;
  filename: string;
  source: 'milahu' | 'anikoto';
  downloads: number; // Used as rating/popularity
  sha256?: string;
}

export interface SubtitleMetadata extends SubtitleResult {
  imdbId: string;
  type: 'movie' | 'episode';
  season?: number;
  episode?: number;
  storedPath: string;
  createdAt: Date;
}

// ── Adblocker Patterns (Ported from milahu/opensubtitles-scraper) ──────────

const AD_PATTERNS = [
  ['-== [ www.OpenSubtitles.com ] ==-'],
  ['-== [ www.OpenSubtitles.org ] ==-'],
  ['-== [ www.OpenSubtitles.net ] ==-'],
  ['-= www.OpenSubtitles.org =-'],
  ['Support us and become VIP member', 'to remove all ads from www.OpenSubtitles.org'],
  ['Support us and become VIP member', 'to remove all ads from OpenSubtitles.org'],
  ['Advertise your product or brand here', 'contact www.OpenSubtitles.org today'],
  ['Please rate this subtitle at www.osdb.link', 'Help other users to choose the best subtitles'],
  ['Watch any video online with Open-SUBTITLES', 'Free Browser extension: osdb.link/ext'],
  ['Subtitle by', 'www.addic7ed.com'],
  ['Sync and corrections by', 'addic7ed.com'],
  ['Downloaded From www.AllSubs.org'],
  ['www.faghoes.tk'],
  ['Subtitles by', 'SDI Media Group'],
  ['Synced by', 'meisam_t72'],
  ['www.phreex.net'],
  ['www.titlovi.com'],
  ['Preuzeto sa www.titlovi.com'],
  ['Translation by'],
  ['Resync by'],
  ['Corrected by'],
  ['Provided by explosiveskull'],
  ['api.OpenSubtitles.org is deprecated'],
  ['5 days of Hacking / Camping / Lectures', 'Join May Contain Hackers: MCH2022.org'],
  ['Who are the real-world Illuminati ?', 'Find out @ saveanilluminati.com'],
  ['Upgraded subtitles by JMH from multiple sources.'],
];

class SubtitleCleaner {
  private regex: RegExp;

  constructor() {
    const lineSep = "(?:\\n|\\r\\n|\\r|\\\\N|\\|)";
    const lineEnd = "(?:\\n|\\r\\n|\\r|\\\\N|\\||$)";
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const parts = AD_PATTERNS.map(lines => {
      const lineGroup = lines.map(l => escape(l)).join(lineSep);
      return `(?:${lineGroup}${lineEnd})`;
    });

    this.regex = new RegExp(parts.join("|"), "gi");
  }

  private detectEncoding(buffer: Buffer): string {
    try {
      const tmpPath = `/tmp/enc_detect_${Date.now()}`;
      fs.writeFileSync(tmpPath, buffer);
      // macOS 'file -I' or Linux 'file -i'
      let output = '';
      try {
        output = execSync(`file -i "${tmpPath}"`).toString();
      } catch {
        output = execSync(`file -I "${tmpPath}"`).toString();
      }
      fs.unlinkSync(tmpPath);
      const match = output.match(/charset=([^;\s\n]+)/);
      return match ? match[1] : 'utf-8';
    } catch {
      return 'utf-8';
    }
  }

  public clean(buffer: Buffer, filename: string): { content: Buffer; format: string } {
    const encoding = this.detectEncoding(buffer);
    let content = buffer.toString(encoding as any);

    // Ad blocking
    content = content.replace(this.regex, "");

    // Extra robust cleanup for known multiline ad variants found in stored files.
    content = content
      .replace(/\s*Support us and become VIP member\s*\r?\n\s*to remove all ads from (?:www\.)?OpenSubtitles\.org\s*/gi, '\n')
      .replace(/\s*Please rate this subtitle at www\.osdb\.link\/[a-z0-9]+\s*\r?\n\s*Help other users to choose the best subtitles\s*/gi, '\n')
      .replace(/\s*Who are the real-world Illuminati \?\s*\r?\n\s*Find out @ saveanilluminati\.com\s*/gi, '\n')
      .replace(/\s*5 days of Hacking \/ Camping \/ Lectures\s*\r?\n\s*Join May Contain Hackers: MCH2022\.org\s*/gi, '\n')
      .replace(/^\s*Upgraded subtitles by JMH from multiple sources\.\s*$/gim, '');

    // Repack: Remove BOM
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }

    // Repack: Fix extension for TXT if it looks like MicroDVD or SRT
    let format = path.extname(filename).slice(1).toLowerCase();
    if (format === 'txt' && (/\{\d+\}\{\d+\}/.test(content) || /^\d+\s+\d{2}:\d{2}:\d{2}/.test(content))) {
      format = content.includes('-->') ? 'srt' : 'sub';
    }

    return {
      content: Buffer.from(content, 'utf-8'),
      format
    };
  }
}

const cleaner = new SubtitleCleaner();

// ── Storage & Hashing ───────────────────────────────────────────────────────

function getSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function storeSubtitleFile(buffer: Buffer): Promise<{ sha256: string; path: string }> {
  const hash = getSha256(buffer);
  const prefix = hash.substring(0, 2);
  const dir = path.join(STORAGE_BASE, prefix);
  const fullPath = path.join(dir, hash);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, buffer);
  }

  return { sha256: hash, path: fullPath };
}

export async function getStoredSubtitle(sha256: string): Promise<Buffer | null> {
  const prefix = sha256.substring(0, 2);
  const fullPath = path.join(STORAGE_BASE, prefix, sha256);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath);
  }
  return null;
}

export async function storeExternalSubtitleFromUrl(url: string): Promise<{ sha256: string; format: string; filename: string } | null> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0',
        'Accept': '*/*'
      },
      timeout: 30000
    });

    const buffer = Buffer.from(response.data);
    const pathname = (() => {
      try {
        return new URL(url).pathname;
      } catch {
        return '/subtitle.vtt';
      }
    })();
    const filename = path.basename(pathname) || 'subtitle.vtt';
    const cleaned = cleaner.clean(buffer, filename);
    const stored = await storeSubtitleFile(cleaned.content);

    return {
      sha256: stored.sha256,
      format: cleaned.format,
      filename
    };
  } catch {
    return null;
  }
}

// ── Milahu Service ──────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
  let files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walkDir(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

export async function searchAndStoreMilahuSubtitles(imdbId: string, type: 'movie' | 'episode', title: string, season?: number, episode?: number): Promise<SubtitleResult[]> {
  try {
    const payload: any = { type, title: title.replace(/ \(\d{4}\)$/, '').trim() };
    if (type === 'episode') {
      payload.season = season;
      payload.episode = episode;
    } else {
      const yearMatch = title.match(/\((\d{4})\)$/);
      if (yearMatch) payload.year = parseInt(yearMatch[1]);
    }

    console.log(`[Milahu] Requesting for: ${JSON.stringify(payload)}`);
    const res = await axios.get(MILAHU_API_URL, {
      params: { 'video-parsed-json': JSON.stringify(payload) },
      responseType: 'arraybuffer',
      timeout: 45000
    });

    const tmpZip = `/tmp/mil_sub_${Date.now()}.zip`;
    const tmpDir = `/tmp/mil_ext_${Date.now()}`;
    fs.writeFileSync(tmpZip, Buffer.from(res.data));
    fs.mkdirSync(tmpDir, { recursive: true });

    const results: SubtitleResult[] = [];
    const db = getDb();

    try {
      execSync(`unzip -o "${tmpZip}" -d "${tmpDir}"`, { stdio: 'pipe' });
      const files = walkDir(tmpDir);

      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (!['.srt', '.ass', '.ssa', '.sub', '.vtt', '.txt'].includes(ext)) continue;

        const buffer = fs.readFileSync(f);
        const { content, format } = cleaner.clean(buffer, f);
        const { sha256, path: storedPath } = await storeSubtitleFile(content);
        
        const idMatch = f.match(/\.(\d{8,})\./);
        const popularity = idMatch ? parseInt(idMatch[1]) : 0;
        const filename = path.basename(f);

        const metadata: SubtitleMetadata = {
          id: filename,
          language: f.toLowerCase().includes('.hun.') ? 'Hungarian' : 'English',
          format,
          filename,
          source: 'milahu',
          downloads: popularity,
          sha256,
          imdbId,
          type,
          season,
          episode,
          storedPath,
          createdAt: new Date()
        };

        // Upsert metadata by SHA256 to handle duplicates across different media if they occur
        await db.collection('subtitles').updateOne(
          { sha256, imdbId, type, season, episode },
          { $set: metadata },
          { upsert: true }
        );

        results.push({
          id: filename,
          language: metadata.language,
          format: metadata.format,
          filename: metadata.filename,
          source: metadata.source,
          downloads: metadata.downloads,
          sha256: metadata.sha256
        });
      }
    } finally {
      if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
      if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
    }

    return results.sort((a, b) => b.downloads - a.downloads);
  } catch (error: any) {
    console.error('[Milahu] Fetch/Process failed:', error.message);
    return [];
  }
}

export async function getSubtitlesFromDb(imdbId: string, type: 'movie' | 'episode', season?: number, episode?: number): Promise<SubtitleResult[]> {
  const db = getDb();
  const query: any = { imdbId, type };
  if (season !== undefined) query.season = season;
  if (episode !== undefined) query.episode = episode;

  const stored = await db.collection<SubtitleMetadata>('subtitles').find(query).toArray();
  return stored.map(s => ({
    id: s.filename,
    language: s.language,
    format: s.format,
    filename: s.filename,
    source: s.source,
    downloads: s.downloads,
    sha256: s.sha256
  })).sort((a, b) => b.downloads - a.downloads);
}
