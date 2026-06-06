import axios from 'axios';
import * as cheerio from 'cheerio';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const SUB_BASE = 'https://feliratok.eu/index.php';
const OS_REST_URL = 'https://rest.opensubtitles.org/search';

export interface SubtitleResult {
  id: string;
  language: string;
  format: string;
  filename: string;
  source: 'feliratok' | 'opensubtitles';
  downloads: number;
}

const LANG_ISO = {
  English: 'eng',    Hungarian: 'hun', French: 'fre',  German: 'ger',
  Spanish: 'spa',    Italian: 'ita',   Portuguese: 'por', Russian: 'rus',
  Japanese: 'jpn',   Chinese: 'chi',   Korean: 'kor',  Dutch: 'dut',
  Polish: 'pol',     Swedish: 'swe',   Norwegian: 'nor', Danish: 'dan',
  Finnish: 'fin',    Czech: 'cze',     Romanian: 'rum', Turkish: 'tur',
  Arabic: 'ara',     Hebrew: 'heb',    Greek: 'ell',   Ukrainian: 'ukr',
};

const LANG_HUN = {
  English: 'angol',    Hungarian: 'magyar',   Spanish: 'spanyol',
  French: 'francia',   German: 'német',       Italian: 'olasz',
  Japanese: 'japán',   Portuguese: 'portugál', Russian: 'orosz',
  Chinese: 'kínai',    Korean: 'koreai',      Arabic: 'arab',
  Dutch: 'holland',    Polish: 'lengyel',     Turkish: 'török',
  Romanian: 'román',   Croatian: 'horvát',    Serbian: 'szerb',
  Czech: 'cseh',       Greek: 'görög',        Swedish: 'svéd',
  Norwegian: 'norvég', Danish: 'dán',         Finnish: 'finn',
};

function langToISO639(lang: string): string {
  return (LANG_ISO as any)[lang] || 'eng';
}

function engToHun(lang: string): string {
  return (LANG_HUN as any)[lang] || '';
}

// ── Feliratok.eu ──────────────────────────────────────────────────────────────

export async function searchFeliratok(title: string, season: number, episode: number, lang: string = 'English'): Promise<SubtitleResult[]> {
  try {
    const lookupTitle = title.replace(/ \(\d{4}\)$/, '').replace(/ \d{4}$/, '').trim();
    const hunLang = engToHun(lang);
    
    // 1. Autoname lookup
    const autoResp = await axios.get(`${SUB_BASE}?action=autoname&nyelv=0&term=${encodeURIComponent(lookupTitle)}`, {
      headers: { 'User-Agent': 'xbmc subtitle plugin' }
    });
    
    const autoData = autoResp.data;
    if (!Array.isArray(autoData) || !autoData.length || autoData[0]?.ID === '-100x') return [];

    let showId = autoData[0].ID;
    for (const entry of autoData) {
      if (entry.ID !== '-100x' && parseInt(entry.ID) > parseInt(showId)) showId = entry.ID;
    }

    // 2. Search
    let searchParams = `action=search&sid=${showId}`;
    if (season > 0) searchParams += `&ev=${season}`;
    if (episode > 0) searchParams += `&epizod=${episode}`;
    if (hunLang) searchParams += `&nyelv=${encodeURIComponent(hunLang)}`;

    const htmlResp = await axios.get(`${SUB_BASE}?${searchParams}`, {
      headers: { 'User-Agent': 'xbmc subtitle plugin' }
    });
    
    const html = htmlResp.data;
    const results: SubtitleResult[] = [];
    const $ = cheerio.load(html);

    // Try to parse using cheerio for better results including downloads
    $('tr.kozep, tr.vilagos').each((_i, el) => {
      const row = $(el);
      const links = row.find('a[href*="fnev="]');
      if (links.length > 0) {
        const href = links.attr('href') || '';
        const fnevMatch = href.match(/fnev=([^&" \n\r]+)/);
        const idMatch = href.match(/felirat=([^&" \n\r]+)/);
        
        if (fnevMatch && idMatch) {
          const filename = decodeURIComponent(fnevMatch[1]);
          const subId = idMatch[1];
          
          // Download count is usually in a td with a specific index or pattern
          // We search for a text that looks like a number in the row
          let downloads = 0;
          row.find('td').each((_j, td) => {
            const text = $(td).text().trim();
            // Look for "Letöltve: X" or just a pure number in a specific column
            if (text.match(/^\d+$/)) {
              downloads = Math.max(downloads, parseInt(text));
            }
          });

          results.push({
            id: subId,
            language: lang,
            format: filename.slice(-3).toLowerCase(),
            filename: filename,
            source: 'feliratok',
            downloads: downloads
          });
        }
      }
    });

    // Fallback to manual parser if cheerio failed to find rows
    if (results.length === 0) {
      const TERMS = '"&\r\n';
      let pos = 0;
      while (true) {
        const fnevIdx = html.indexOf('fnev=', pos);
        if (fnevIdx === -1) break;
        const fnevStart = fnevIdx + 5;
        let fnevEnd = -1;
        for (let i = fnevStart; i < html.length; i++) {
          if (TERMS.includes(html[i])) { fnevEnd = i; break; }
        }
        if (fnevEnd === -1) break;
        const filename = html.slice(fnevStart, fnevEnd);

        const idIdx = html.indexOf('felirat=', fnevEnd);
        if (idIdx === -1) break;
        const idStart = idIdx + 8;
        let idEnd = -1;
        for (let i = idStart; i < html.length; i++) {
          if (TERMS.includes(html[i])) { idEnd = i; break; }
        }
        if (idEnd === -1) break;
        const subId = html.slice(idStart, idEnd);

        results.push({
          id: subId,
          language: lang,
          format: filename.slice(-3).toLowerCase(),
          filename: filename,
          source: 'feliratok',
          downloads: 0
        });
        pos = idEnd;
      }
    }

    return results.sort((a, b) => b.downloads - a.downloads);
  } catch (error) {
    console.error('[Feliratok] Search failed:', error);
    return [];
  }
}

// ── OpenSubtitles (Legacy REST) ───────────────────────────────────────────────

export async function searchOpenSubtitlesLegacy(imdbId: string, lang: string = 'English'): Promise<SubtitleResult[]> {
  try {
    let imdbNum = imdbId.startsWith('tt') ? imdbId.slice(2) : imdbId;
    imdbNum = imdbNum.replace(/^0+/, '');
    const langCode = langToISO639(lang);
    
    const searchURL = `${OS_REST_URL}/imdbid-${imdbNum}/sublanguageid-${langCode}`;
    const res = await axios.get(searchURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:153.0) Gecko/20100101 Firefox/153.0',
        'X-User-Agent': 'trailers.to-UA',
        'Accept': '*/*',
        'Referer': 'https://brightpathsignals.com/',
      }
    });

    const data = res.data;
    if (!Array.isArray(data)) return [];

    return data.map((s: any) => ({
      id: s.IDSubtitleFile,
      language: s.LanguageName || lang,
      format: 'srt',
      filename: s.SubFileName,
      source: 'opensubtitles' as const,
      downloadLink: s.SubDownloadLink,
      downloads: parseInt(s.SubDownloadsCnt || '0')
    })).sort((a, b) => b.downloads - a.downloads);
  } catch (error) {
    console.error('[OpenSubtitles] Search failed:', error);
    return [];
  }
}

// ── Download Helpers ──────────────────────────────────────────────────────────

function walkDir(dir: string, depth: number = 0): string[] {
  if (depth > 5) return [];
  const files: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          files.push(...walkDir(full, depth + 1));
        } else if (/\.(srt|sub)$/i.test(entry)) {
          files.push(full);
        }
      } catch {}
    }
  } catch {}
  return files;
}

function findEpisodeSubtitle(extractDir: string, episode: number): string {
  const files = walkDir(extractDir);
  if (!files.length) return '';

  const ep2 = String(episode).padStart(2, '0');
  const ep1 = String(episode);
  let best = '';
  let bestScore = -1;

  for (const f of files) {
    const lf = f.toLowerCase();
    let score = 0;
    if (lf.includes(`- ${ep2} -`)) score = 10;
    else if (lf.includes(`e${ep2}`)) score = 9;
    else if (lf.includes(`_${ep2}_`)) score = 8;
    else if (lf.includes(`.${ep2}.`)) score = 7;
    else if (lf.includes(`- ${ep1} -`)) score = 6;
    else if (lf.includes(`e${ep1}.`)) score = 5;

    if (score > bestScore) {
      bestScore = score;
      best = f;
    } else if (bestScore < 0) best = f;
  }
  return best;
}

export async function getFeliratokDownload(subId: string, episode?: number): Promise<Buffer | null> {
  try {
    const dlURL = `${SUB_BASE}?action=letolt&felirat=${subId}`;
    console.log(`[Feliratok] Downloading subtitle ${subId} for episode ${episode}...`);
    const res = await axios.get(dlURL, {
      headers: { 'User-Agent': 'xbmc subtitle plugin' },
      responseType: 'arraybuffer'
    });
    
    const buffer = Buffer.from(res.data);
    
    // Better detection using magic bytes
    const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B; // PK
    const isRar = buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21; // Rar!
    
    if (isZip || isRar) {
      console.log(`[Feliratok] Detected archive format: ${isZip ? 'ZIP' : 'RAR'}`);
      const tmpPath = `/tmp/aniapi_sub_${subId}.${isZip ? 'zip' : 'rar'}`;
      const extractDir = `/tmp/aniapi_sub_ext_${subId}`;
      
      fs.writeFileSync(tmpPath, buffer);
      
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }
      fs.mkdirSync(extractDir, { recursive: true });
      
      try {
        console.log(`[Feliratok] Extracting archive to ${extractDir}...`);
        
        if (isRar) {
          // unrar x: Extract with full paths
          // -y: Assume Yes
          // -idq: Quiet mode
          console.log(`[Feliratok] Using unrar for RAR extraction`);
          execSync(`unrar x "${tmpPath}" "${extractDir}/" -y -idq`, { stdio: 'pipe' });
        } else {
          // 7z x: Extract with full paths
          // -o: Output directory
          // -y: Assume Yes
          console.log(`[Feliratok] Using 7z for ZIP extraction`);
          execSync(`7z x "${tmpPath}" -o"${extractDir}" -y`, { stdio: 'pipe' });
        }
        
        const subFile = findEpisodeSubtitle(extractDir, episode || 1);
        if (subFile && fs.existsSync(subFile)) {
          console.log(`[Feliratok] Found matching subtitle file: ${subFile}`);
          const content = fs.readFileSync(subFile);
          // Cleanup
          fs.rmSync(extractDir, { recursive: true, force: true });
          fs.unlinkSync(tmpPath);
          return content;
        } else {
          console.log(`[Feliratok] No matching subtitle file found for episode ${episode} in archive.`);
          // List files to help debug
          const allFiles = walkDir(extractDir);
          console.log(`[Feliratok] Files in archive: ${allFiles.join(', ')}`);
        }
      } catch (e: any) {
        console.error('[Feliratok] Extraction failed:', e.message);
        if (e.stdout) console.error('7z stdout:', e.stdout.toString());
        if (e.stderr) console.error('7z stderr:', e.stderr.toString());
      }
      
      // Cleanup on failure
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      
      // If we are here, we failed to get a specific file from the archive.
      // We should NOT return the binary archive as it's not what the user wants.
      return null; 
    }

    return buffer;
  } catch (error) {
    console.error('[Feliratok] Download failed:', error);
    return null;
  }
}

export async function getOpenSubtitlesDownload(downloadLink: string): Promise<Buffer | null> {
  try {
    const res = await axios.get(downloadLink, {
      headers: {
        'User-Agent': 'xbmc subtitle plugin',
        'Accept': '*/*',
      },
      responseType: 'arraybuffer'
    });
    
    // Decompress if it's GZIP
    try {
      return zlib.gunzipSync(Buffer.from(res.data));
    } catch {
      return Buffer.from(res.data);
    }
  } catch (error) {
    console.error('[OpenSubtitles] Download failed:', error);
    return null;
  }
}
