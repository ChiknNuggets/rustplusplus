// Interactive Vendor Map plugin for RustPlusPlus.
// Runs a local, token-protected web UI for browsing vending machines and traveling vendors.

const http = require('http');
const https = require('https');
const { URL } = require('url');
const Path = require('path');
const Fs = require('fs');
const Scrape = require('../src/util/scrape.js');

const PLUGIN_NAME = 'vendor-map-web.js';

let server = null;
let serverPort = null;
let serverHost = null;
let serverRequestedPort = null;
let authToken = null;
let configWatcher = null;
let serverClosing = null;
const steamAvatarCache = new Map();
const battlemetricsHoursCache = new Map();
const STEAM_AVATAR_CACHE_MS = 24 * 60 * 60 * 1000;
const STEAM_AVATAR_RETRY_MS = 10 * 60 * 1000;
const BATTLEMETRICS_HOURS_CACHE_MS = 12 * 60 * 60 * 1000;
const UNAVATAR_STEAM_URL = 'https://unavatar.io/steam/';
const recentEvents = new Map();
const STATIC_FILE_DIRS = [
  Path.join(__dirname, '..', 'src', 'staticFiles'),
  Path.join(__dirname, '..', 'src', 'staticfiles')
];
const itemIconState = {
  paths: STATIC_FILE_DIRS.map((dir) => Path.join(dir, 'item-icons-embedded.js')),
  path: null,
  mtimeMs: 0,
  icons: {},
  fileIndex: null
};

const VENDING_MACHINE_MARKER_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAAEsCAYAAAB5fY51AAAWk0lEQVR4nO3dCZAc1WHG8a9nT+2utCutVvexkpAAEeJDgMEXIfgAg4MhcVxOsI0rTsAQH5A4ToWKcewi5dgJwQmOTeIAZZeTKpyAC2z5SlymKpjDyECMFJAsaSWt0M1e2nt2JvV6e8TMaHc13T3dPW/m/6uakjSao+f19DfvvX79ngAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgak6Y199x6Xlx7KBuSZdI+nVJZ3v/XiJpgaT5cWwAUIWGJA1KOiqpR9JOSc9LelLS3qg/7ubHtgd6Xn3ZtyS8Okm/Kek6SVd4AQWgvOZ7t5WSXlf0yibAfiDpYUk/kZSulLKvpMAyBffHkm6QtKwCtgeoVaaScJN3OyzpAUn3SDqYdHmkKmCHrJP0VUm7Jf05YQVUlGXecWmOz695x2tikgysVklfkPSil+RNlbWfAOQxx+eN3vFqjtu2JAonqcC62vTZS/q0pMaEtgGAf43ecbvdO45jFXdgNUi6S9IjktbwZQGstcY7ju/yjutYxBlYyyU9LunWsMMpAFQExzuef+adNItcXIG1yftQF/I9A6rOBZL+xzvOIxVHYG3xPgzjqYDq1e0d51ui/IRRB9b5kn4oqSvi9wGQvC7veD8/qi2JMrBWSdoqqTPC9wBQWTq9435VFFsVVWA1ecP6I9loABXNHPffkdRc7o2MKrD+3uuIA1Cbtng5UFZRBNZVkj7KlxSoeTd5eVA25Q6sFkn/VOt7CcApX/FyoSzKHVh/yQh2AHnWerlQFuUMrG5v1CsA5LutXOMwyxlYf8aMCwBm0OjlQ2jlCixzneCH2VMAZvFhLydCKVdg3RLFmAsAVcPkw8fCfphyBJZ5jeurp1wBROQGb82GwMoRWG/xzgQAwFxMk/CypAPrfewiACW6LkxBlSOwrmRPASjRu8IUVNjAWss8VwB8WBumCylsYL2BPQXAp8C5ETawileMBYAzeU3QEgobWGezawD4dG7QAgsbWFzoDMCvwLkRNrCY/hiAX4Ev0QkbWIksVw3AaoFzI2xgzed7A8CnBUELLGxgMZ0MgNjEuVQ9AIRCYAGwBoEFwBoEFgBrEFgArFHPropPOptV79ikth4d0NP9w9o3OqHRqUytfPyqMK8upbXzGnVxR6uuWNKuVc0NqnecWi+W2BBYMemfnNIDvSf0bwdPaDST1VQ2WxOfu9oMpqd0ZHxS2wZGdN+B47p+Vac+tKpT7fWhZv5FiQisGBwYm9Bnd76sJ/uGRUxVB/ODc3Iqq3v3HdMvB0f1mU3Ltbq5sdaLJXL0YUXsxETaDasnCKuqZPbp430n9Vc7D+mVyXStF0fkCKwImV/h+3tPuGGF6vazvpP6Ru8J0SMZLQIrQntHJvTN3hOh36DOcdyb6fBtyPt7/r/r6PhN3Dd6X1HPyHiNl0K06MOK0NZjA5oM2LluAqgx9WoINaUcNTqO6hsc5V7S/Jpns1lNeHekM1mNZ7Lu/Zmi9829Uta7pYr+7jiO+5zcv3M1hfzH5V4nO8Nrhvm/ajGWyej7Rwd0S/eSKvtklYPAitBTZ2gKds9r1FmthQtm1zm5Px33dHmjF1TunylHKVOb8h475QaTNJHJKJ01AZDVRCarscyrUZD2/p7LvqwXGM4MgWEemv+4vJdRRlnveY77d79mer9iJmNNRbE44ysp2HYNj7nDUWbzRP+wuww6okFgRahndPbmwbqWJn1582qd1cqEFzbZOTymT2w/MGto9YzMHmYIjz6sCJ1Mz94Fe1FHK2FloU2tzXpDR+usGz6Unqr1IooUgRWhuZoyxX1MqI79yl6NFoEVobnO22X4Zltrrn3HudpoEVgArEFgJaSOn2LANwIrAQz0BIJhWEMCTFQxJcnccuPFcoNjlTc2bHpMmOMOpkVtIbASYMKqnoNtTrnScZsAjnPq7Nt0U5qyq1UEVsxMU7AhdebawUdf2K/HTgzFvn0bWpr06IVnzfr/mx/bHuv2JGXHpefVxOe0DX1YMTMXK5uwaqaGBfhGYMXM5JSZZaEpRdEDfnHUxCh3dtDUsqhhAf4RWDGaPjs4Xcui0x3wj8CKUSpv6pgUZ7oA3zhLGKPcNWh1Xk0rKBN4K5obAj3bvPeh8Ul3or9yMmcXt7S3WLU/zMo3u5kh1CoEVszMgEcn5KDRRQ11+uFFGwM///3P7tHzg6Nl/eAXdrTqMxuXl/U1o/a5XYcILMvQJIxRrkk4adYlrI2PDJQVNawYmemLJ5yMuwI082EB/lHDilnWW/5rkgmxAN8IrJg5uYUjqGEBvhFYMUt7YTU6RWABftGHFTOzJNd4xnGbhQD8oYYVo1MLiGYVeIFVoJYRWAkwKwRP0OkO+EZgxSgXUdOrNRNYgF8EVoxONQk1vaw8AH8ILADW4CxhjPLrVLQIAf+oYQGwBoEVs/x+LAD+EFgJIKyAYAismGVq6tMC5UVgxYyJkYHgCKwEZJkPCwiEwIoZMQUER2ABsAaBlQBqWUAwBFYC6HgHgiGwEkANCwiGwEoAgQUEQ2AlwDQJwy6mCtQiAisBDv1YQCAEVkIILMA/AitmueYggQX4R2ABsAaBBcAaBFZCOEloL/ZdcgisBKTcviy+9YBfBFbMsizzBQRGYCWEGpa92HPJIbBilhs0Sg0L8I/ASgBRBQRDYCWAwLIb+y85BFZCmNLdXvRhJYfAAmANAitm2dyqOTX1qasLlePkEFgJMBc/86W3F03C5NTX6gdHef28f1if3fmyVaW6bWCkArYCfhBYCchWYY/77pFx9wZEiSZhArJVGlq1gj2XHAIrAaYPJMUl/9ZizyWHwEpAll9pIBACKwGmdkWT0F7sueQQWAmhSWgv9lxyOEuYAJtrVzsuPa8CtgK1ihpWAlhEFQiGwEqAqWHRDwL4R2ABRfgxqVwEVgKydNxWLLNvMmfoYyTQkkNgJYAzhJXLKaGPkREpySGwEmD6sCj4ysW+qVzsmwSYX3AqWYB/BFbMHPqvgMAIrASkHKmeKhbgG4EVM3emBupYQCBcmhMzc4awzqm+M4VpSQ/sP65Hjvard3RS45nMqeEbTamUVs9r1LVLO/SB1Z2qi3hbzPs+0z+sHx0f1C8GRnRwbFLDUxktaqjTkqYGndfWrLd3LdAlC9v4xbYMgRWj/IMj6oM2Tv/Qc1T3HTiuiczp5/vNPWOZjHYNj+mLew7r7p4jumlNl25a2xXJFj7RN+y+z0snx077v2MTafe2fWhUDx7q0/qWJv3J+qW6rHN+ksUHH/iBiZnpv6pznKqoYY1kMrrq57v0tX3HZgyrmZjHmYC75plfabzE55RiKpvVnb86pD/4354Zw2ome0bGdcsL+3X7Swc1yeAqKxBYMcp4gw5NaNkeVyas3vbkTu0dmQj0/F3D43rbUzvLElomrG7b0atvHXwl0PMfPtyvm3+5n9CyAE3CGKXcMVjV8Vneu22P+ienTrt/RXODrlnaoauXtmvdvCa3FvPIkX49cmRAh8cnCx57YiKt9/1ij75zwYZQ23LXniP68fHBgvtMMZt+qquXtOv17S1a1FDvbu9zgyPaenTAveWvDfl430l9buchff7sFaG2BdEisGJmfsRt/yG/p+eo9hatkNPgOLrznJVuQOQz/USfXLfUvZmazB07X1Y6rwB2Do/p6/uP6yNrFgfaFrNU1wO9JwruM6H5pXNX6XULWgru72io0290zndvN6xerE/9X2/B5/jPw326fPH0/6My0SRMgM1zupuzgV8/cLzgPjOm7OELNpwWVsWuXdahB7esd/vw8n1l37HAK2H/7Z7DBWW5tKlB33rtutPCqtjmtmZ987XdWjOvsej1jrAqdwUjsGJUeCDYGVlm6EJxB/udZ69wa1KlOKe1WZ/ZuLzgkWYIxL8fPFHS8/O9MDSq5wdHC+77m3NWuqFVCtNMvHvz6oIANU3YJ/pO+i8YxILAilGusE0ncdrSKpYZZ5XPNL/evbTD12u8d/lCLWks7I146HD/rI+fTXG/1VsXtemijlZfr3FOW7Ou7FpQcN+Pjw3O+ngki8CKUca7TWXtbRIeGC08K/jbyxYGep3ikNs36v9s43NFtaurfQZnzlVFTdnnh0bnejgSRGDFbHp6ZHt73oubg+8oqp2U6rLFhR3bZnCpXwfHCkPu1+bPC7Qtxc97eWxy1sciWQRWAswxb2uTsHizu4s6rUu1urnweUGGYw2lC0Ouoz7Y9QMLi5qnQ+nTh2ugMhBY8KV4GFlPgKaccaCodhTkizi/vvBZ/QGDpm8iXfS61XThVHUhsBJQZ/EEfo2pwg3/UcAO6p8eHyr4d3Od/6/iyqJa2gsB+56Kn2dOJKAyEVgxM7ONmnkMbC34VUVNwIcO9wV6HTP6Pd/aAE3L1y4o7Hv63tGBQNtS/LzXBOwLQ/QIrATUW3zx8zVLCs/EmalbvuszKL59qE9Hi5phZlCpX29fXNjh/9iJIT0zMOLrVcyF0t8vqiW+bXGwEwmIHoEVo5QbVtOXsdRb2iS8Yc1iNRQ1C//ixYPugMtSvDg8ps/tOlTwyKaUo99b2el7W8zZvfOLakPmcpsj46Wd5XtlMq1P7DjgjovLMQNg37iozfe2IB4EVowcr2Zl+oEaUnYWvTmf9pHVhdf9mWsDr31mtx49Mvfgz4cP9+l3t+0pCAjj5rVLAn8RP7VhWcGJABNW1z+3173IeS6mZvXB53q0v+ikgZkfi4OicnHxc0xyB0HKaxI2Wjxtw8e6l+gHxwYLLhw2U7N8+sWD7lxXv7W0w21WrW9tcgeafvdIvx49MqBDM9R8NrY26w8DXvhsXNDeohtWder+vAugTTP195/de2q2hi3trWpvqHNnhzCT9800W4Nx3bKFTOZX4QisGNV7k/eZJlVTyu55Zr69Zb07H1bxFDMmLL6675h7O5POxno9+Pr1obfltvVL1Ts2WXCpTtY7g1nqWcw3LWzTHZuWl/BIJInAilmdt2JOfYjAemVySu98eleg55oRRjPVdPxqSaX0Xxdv0u9s262eAJP4bWhp0n9s2VCW4DY/AndtXqUv7D4caBI/0+H/2U0r3L5FVDYCKya55c8dOV6ne/CDw/QBFV/TlwQTWlsv3Og2A//1wHFNljBc3fTf3bimSx8t85zuJrRuP2u526T70u4jemn4zNMkr2tp0p8yp7tVCKwYmbBynOlaVjX5ePcS3dy9RPftP+b2VfWOTbjXHOZWzWl0V81p0HuWduhDqxdHugDHGxe26aEL2vS0WTXn2KDb+W6ai+Zym9a6lDuOzIyzunzxAr1pEavm2IbASki1HSjmi/RHa7rcW9JMSL6ho9W9obrwA5OA7GmT+QEoBYEVk9y0Mtns9Lil4rFIAM6MwIqZCS3TOZ0msADf6MOKWdqbC+tMZ9Q2tTbp8NikO+AxLmYSvQ0lzs0OJIEaVoxMUJmmoBkVXupKyQBeRQ0rJhlv0GbGq11NnKFJeOu6pe4Np8uVHMM8aw+BFSO3490x86JnShpkWfGfp4THlCtUcms5Zr2gNwt5FE8miOpHYMUo4zULHe9iYdvFGRdO7v28KwSqbfAtSkMfVgLcdQnpwwJ8I7BiZsIq480hBcAfAisBWcIKCITASkCmxA5rAIUIrITQhQX4R2ABsAbDGirUvfuPuTN55qZUNoNO85cGM9ckmrFIGXPGMe+Cavc+r8HpeE1PJzcXl/fv/OFLuZre9KXZhfeZ13FmaL5mTz0n776ix8w06qDUkQjmY+Zvu4pqpDNVTstZYTWXRTFotzIRWBXqv48PqWdkfHqlnRlWizahYSIm7YXWVPbV0JnKBUo2e2qm01ReAMw0Ujxb9KdOzTBR+JiZnuPXXK+RmuH/Znt8VK1qcw0ngVWZCKwKZWbHHM2YFaKzp2pEjgprWPJqHrm5tXJnHwvm2sqNDC/TxyxHSMz1GjPNExZ3d1+cF5zDHwKrQuUuQ5nyakymppTNZk7VmHLyh0gwKSCqHYFVwWaqKZk/U4QTahRnCS1EWKFWEVgArEGT0ELmjOEiOoZDMYvRMq++fQgsC61obtAPL9pY68UQilk5uxIWo4U/NAkBWIPAAmANAguANQgsANYgsABYg8ACYA0CC4A1CCwA1iCwAFiDwAJgDQILgDUILADWILAAWIPAshATy4RHGdqJ6WUsdGh8Uu9/dk+tF0MopgxhHwLLQuOZrJ4fHK31YkANokkIwBoEFgBrEFgArEFgAbAGgVWhxjKsPpgUyr5ycZawQm1oadJwmgMnCabsUZkIrAp159kra70IgNPQJARgDQILgDUILADWILAAWIPAAmANAguANQgsANYgsCKUneOlU471H69mzbXv5trnCI/AitBcmZRySCxbzbXn2KvRIrAi1Fo/e/E+2XdSO4fHquBT1paXTo7pqf7hWT/z/HomX44Sl+ZEaN28Jj07OTLjG+wbndDHtx/QptbmKvm0tcH8yOwfnZj1s3a3NNZ6EUWKwIrQJQtb9ezgzIFlmC/+XF9+2OeShW3stQjRJIzQFV3taqR3vWY0p1K6smtBrRdDpAisCK1vbdIHV3ZW7edDoQ+t6lQ3U9NEisCKUMr7Er+RZkLVe/OiNn1g1SIOqIhRvhHrbKzXHZuWu19oGofVx+zTtyxq0x0bV2hRA13CUSOwYrC6uVFfOneVbl7b5Z72rmMMlvXMPjT78pbuJe6+XdncUOtFEgt+EmLSXl+nG9d26d1LO7T16IA7lscMbRiZYhpkm7TUpbR2XqMuXtiqK7vataK5QfX8AMUmVEnvuPQ8rkQA4Nvmx7YHyh6ahACsQWABsAaBBcAaBBYAaxBYAKxBYAGwRtjAGmdXA4hL2MAaYk8B8GkwaIGFDayT7CkAPgXOjbCBdYI9BcCnQ0ELLGxg7WdPAfApcG6EDayX2FMAfHoxaIGFDazn2FMAfAqcG2ED60n2FACfngpaYGEDa593A4DIM6McI923luE1ANSGUHlRjsB6mC8agBI9FKagyhFYP5F0mL0F4AxMTvw0TCGVI7CmJD3AngJwBvdLSocppHLN1vCPXAgNYA4mH+4JW0DlCqyXJd1XptcCUH3u93IilHLOh/VFSRN80QAUmfTyIbRyBlaPpLvYUwCK/J2kveUolHLPOPp5LogGkGe/lwtlUe7AGpF0M3sLgOdmLxfKIoo53b8n6V72FlDz7vXyoGyiWoTik5K21freAmrYNi8HyiqqwBqT9B5JvXxjgZrT6x3/Y+X+4FEu82U2+l1MowzUlFe84z6SykrU6xL+UtI7JR2L+H0AJM8c5+/wjvtIxLGQqmnLvpl5s4CqZo7vt0bddx3Xys87Jb1J0jMxvR+A+DzjHd+B52ovVZxL1R/0alp3S8rG+L4AomGO4y97x/XBOMo4zsCSd8X2rZKuYUQ8YLUD3nH8yThnaok7sHIelXQeF0wD1sldyLzZO45jlVRgyVuu+tOSzpH0zwQXUNEmvOP0HO+4DbzcfBhJBlaOuYr7RknrJf01TUWgouz3jssN3nG6J8mNq4TAyjGddrdLWifpckn/wkh5IBG93vF3uXc83l4px2J9BWxDsYy3sMVPvPtNzetiSa+RdLakbkmLJbVLaquczQasYpp0A5KOe3PZvSTpeW9x5ERrUQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoApJ+n+HxhJj0QaEKQAAAABJRU5ErkJggg==';
const STACKED_VENDING_MACHINE_MARKER_IMAGE = 'data:image/png;base64,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';

module.exports = {
  defaultEnabled: false,
  displayName: 'Interactive Vendor Map',
  description: 'Token-protected local web UI with pan/zoom map, vendor search, filters, and live vendor details.',

  configSchema: {
    bindHost: { type: 'text', label: 'IP', default: '127.0.0.1' },
    port: { type: 'text', label: 'Port (0 = random)', default: '0' },
    publicIpAddress: { type: 'text', label: 'Public IP address or hostname', default: '' },
    autoRefreshSeconds: { type: 'text', label: 'Auto-refresh seconds', default: '5' }
  },

  onLoad: ({ client }) => {
    startConfigWatcher(client);
  },

  onEnabled: async ({ client, guild }) => {
    await ensureServer(client, guild?.id);
    logUrl(client, guild?.id);
  },

  onDisabled: async ({ client }) => {
    const preferredGuildId = getPreferredConfigGuildId(client);
    if (preferredGuildId) await ensureServer(client, preferredGuildId);
    else await closeServer();
  },

  onUnload: async () => {
    await closeServer();
    if (configWatcher) clearInterval(configWatcher);
    configWatcher = null;
    authToken = null;
    recentEvents.clear();
  },

  onMapUpdated: ({ rustplus }) => rememberEvent(rustplus?.guildId, 'Map markers refreshed'),
  onVendingMachineDetected: ({ rustplus, location }) => rememberEvent(rustplus?.guildId, `New vending machine at ${location?.string || 'unknown'}`),
  onTravelingVendorSpawned: ({ rustplus, location }) => rememberEvent(rustplus?.guildId, `Traveling vendor spawned at ${location?.string || 'unknown'}`),
  onTravelingVendorLeft: ({ rustplus, location }) => rememberEvent(rustplus?.guildId, `Traveling vendor left ${location?.string || 'the map'}`),
  onTravelingVendorHalted: ({ rustplus, location }) => rememberEvent(rustplus?.guildId, `Traveling vendor halted at ${location?.string || 'unknown'}`),
  onTravelingVendorResumed: ({ rustplus, location }) => rememberEvent(rustplus?.guildId, `Traveling vendor resumed at ${location?.string || 'unknown'}`),

  slashCommands: [
    {
      name: 'vendormap',
      getData() {
        const Builder = require('@discordjs/builders');
        return new Builder.SlashCommandBuilder()
          .setName('vendormap')
          .setDescription('Get the local interactive vendor map URL');
      },
      async execute(client, interaction) {
        const verifyId = Math.floor(100000 + Math.random() * 900000);
        client.logInteraction(interaction, verifyId, 'slashCommand');
        if (!await client.validatePermissions(interaction)) return;
        await ensureServer(client, interaction.guildId);
        const url = getPublicUrl(client, interaction.guildId);
        await interaction.reply({
          ephemeral: true,
          content: url ? `Interactive vendor map: ${url}` : 'Vendor map server is starting. Try again in a few seconds.'
        });
      }
    }
  ]
};

async function ensureServer(client, guildId = null) {
  if (!authToken) authToken = generateToken();
  startConfigWatcher(client);

  const desired = getDefaultServerConfig(client, guildId);
  if (server) {
    if (serverHost === desired.host && serverRequestedPort === desired.port) return;
    await closeServer();
  }
  if (serverClosing) await serverClosing;

  serverHost = desired.host;
  serverRequestedPort = desired.port;
  server = http.createServer(async (req, res) => {
    try {
      await handleRequest(client, req, res);
    }
    catch (err) {
      sendJson(res, 500, { ok: false, error: err?.message || 'server error' });
    }
  });

  server.on('error', (err) => {
    server = null;
    serverPort = null;
    serverHost = null;
    serverRequestedPort = null;
    client.log(client.intlGet(null, 'errorCap'), `[vendor-map] server error: ${err?.message || err}`, 'error');
  });

  await new Promise((resolve) => {
    const activeServer = server;
    activeServer.once('listening', () => {
      serverPort = activeServer.address().port;
      client.log(client.intlGet(null, 'infoCap'), `[vendor-map] listening at ${getPublicUrl(client, guildId)} (configured ${desired.host}:${desired.port || 'random'})`);
      resolve();
    });
    activeServer.once('error', () => resolve());
    activeServer.listen(desired.port, desired.host);
  });
}

async function closeServer() {
  const activeServer = server;
  server = null;
  serverPort = null;
  serverHost = null;
  serverRequestedPort = null;
  if (!activeServer) {
    if (serverClosing) await serverClosing;
    return;
  }

  serverClosing = new Promise((resolve) => {
    try {
      if (activeServer.listening) activeServer.close(() => resolve());
      else resolve();
    }
    catch (_) { resolve(); }
  });
  await serverClosing;
  serverClosing = null;
}

function startConfigWatcher(client) {
  if (configWatcher) return;
  configWatcher = setInterval(async () => {
    const preferredGuildId = getPreferredConfigGuildId(client);
    if (!preferredGuildId) {
      if (server) await closeServer();
      return;
    }
    if (!server) {
      await ensureServer(client, preferredGuildId);
      return;
    }
    const desired = getDefaultServerConfig(client, preferredGuildId);
    if (serverHost !== desired.host || serverRequestedPort !== desired.port) {
      client.log(client.intlGet(null, 'infoCap'), `[vendor-map] restarting to apply configured bind ${desired.host}:${desired.port || 'random'}`);
      await ensureServer(client, preferredGuildId);
    }
  }, 5000);
}

function getDefaultServerConfig(client, guildId = null) {
  const settings = guildId ? getPluginSettings(client, guildId) : getFirstPluginSettings(client);
  const host = String(settings.bindHost || '127.0.0.1').trim() || '127.0.0.1';
  const parsedPort = parseInt(settings.port, 10);
  return { host, port: Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65535 ? parsedPort : 0 };
}

function getFirstPluginSettings(client) {
  const preferredGuildId = getPreferredConfigGuildId(client);
  return preferredGuildId ? getPluginSettings(client, preferredGuildId) : {};
}

function getPreferredConfigGuildId(client) {
  try {
    for (const guild of client.guilds.cache.values()) {
      const instance = client.getInstance(guild.id);
      const settings = instance?.pluginSettings?.[PLUGIN_NAME];
      if (settings && settings.enabled !== false && (settings.port !== undefined || settings.bindHost !== undefined)) return guild.id;
    }
    for (const guild of client.guilds.cache.values()) {
      const instance = client.getInstance(guild.id);
      const settings = instance?.pluginSettings?.[PLUGIN_NAME];
      if (settings && settings.enabled !== false) return guild.id;
    }
  }
  catch (_) { /* ignore */ }
  return null;
}

function getPluginSettings(client, guildId) {
  try {
    const instance = client.getInstance(guildId);
    return instance?.pluginSettings?.[PLUGIN_NAME] || {};
  }
  catch (_) {
    return {};
  }
}

function logUrl(client, guildId) {
  const url = getPublicUrl(client, guildId);
  if (!url) return;
  client.log(client.intlGet(null, 'infoCap'), `[vendor-map] URL${guildId ? ` for guild ${guildId}` : ''}: ${url}`);
}

function getPublicUrl(client, guildId = '') {
  if (!serverPort || !authToken) return null;
  const origin = getPublicOrigin(client, guildId);
  const guildPart = guildId ? `&guildId=${encodeURIComponent(guildId)}` : '';
  return `${origin}/?token=${encodeURIComponent(authToken)}${guildPart}`;
}

function getPublicOrigin(client, guildId = '') {
  const settings = guildId ? getPluginSettings(client, guildId) : getFirstPluginSettings(client);
  const configured = String(settings.publicIpAddress || '').trim();
  if (!configured) return `http://127.0.0.1:${serverPort}`;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(configured);
  try {
    const parsed = new URL(hasScheme ? configured : `http://${configured}`);
    if (!parsed.port) parsed.port = `${serverPort}`;
    return `${parsed.protocol}//${parsed.host}`;
  }
  catch (_) {
    const host = configured.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/.*$/, '');
    return `http://${host}:${serverPort}`;
  }
}

async function handleRequest(client, req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/app.css') return sendCss(res, 200, appCss());
  if (req.method === 'GET' && url.pathname === '/app.js') return sendJs(res, 200, appJs());
  if (req.method === 'GET' && url.pathname === '/favicon.svg') return sendSvg(res, 200, faviconSvg());

  if (!isAuthorized(url, req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

  if (req.method === 'GET' && url.pathname === '/') return sendHtml(res, 200, htmlPage());
  if (req.method === 'GET' && url.pathname.startsWith('/item-icons/')) return sendLocalItemIcon(url, res);
  if (req.method === 'GET' && url.pathname.startsWith('/map-image/')) return sendMapImage(url, req, res);
  if (req.method === 'GET' && url.pathname === '/api/guilds') return sendJson(res, 200, listGuilds(client));
  if (req.method === 'GET' && url.pathname === '/api/vendor-map') return sendJson(res, 200, await getVendorMap(client, url));
  if (req.method === 'GET' && url.pathname === '/api/team') return sendJson(res, 200, await getTeamData(client, url));
  if (req.method === 'GET' && url.pathname === '/api/export') return sendJson(res, 200, await getVendorMap(client, url, true));
  if (req.method === 'POST' && url.pathname === '/api/team/promote') return postTeamPromote(client, url, req, res);
  if (req.method === 'POST' && url.pathname === '/api/team/kick') return postTeamKick(client, url, req, res);
  if (req.method === 'POST' && url.pathname === '/api/home') return postHome(client, url, req, res);
  if (req.method === 'POST' && url.pathname === '/api/refresh-interval') return postRefreshInterval(client, url, req, res);
  if (req.method === 'POST' && url.pathname === '/api/annotations') return postAnnotations(client, url, req, res);

  return sendJson(res, 404, { ok: false, error: 'not found' });
}

async function postHome(client, url, req, res) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return sendJson(res, 400, { ok: false, error: 'guildId required' });
  const body = await readJson(req);
  try {
    const instance = client.getInstance(guildId);
    if (!instance) return sendJson(res, 404, { ok: false, error: 'guild not found' });
    if (!instance.pluginSettings) instance.pluginSettings = {};
    if (!instance.pluginSettings[PLUGIN_NAME]) instance.pluginSettings[PLUGIN_NAME] = {};

    if (body && body.clear === true) {
      instance.pluginSettings[PLUGIN_NAME].homeLocation = '';
    }
    else {
      const x = Number(body?.x);
      const y = Number(body?.y);
      const radius = Number(body?.radius || 100);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0) {
        return sendJson(res, 400, { ok: false, error: 'valid x, y, and radius required' });
      }
      instance.pluginSettings[PLUGIN_NAME].homeLocation = `${Math.round(x)},${Math.round(y)},${Math.round(radius)}`;
    }

    client.setInstance(guildId, instance);
    return sendJson(res, 200, { ok: true, home: parseHomeLocation(instance.pluginSettings[PLUGIN_NAME].homeLocation) });
  }
  catch (err) {
    return sendJson(res, 500, { ok: false, error: err?.message || 'failed to save home' });
  }
}

async function postRefreshInterval(client, url, req, res) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return sendJson(res, 400, { ok: false, error: 'guildId required' });
  const body = await readJson(req);
  const seconds = parseInt(body?.seconds, 10);
  if (!Number.isInteger(seconds) || seconds < 2 || seconds > 3600) {
    return sendJson(res, 400, { ok: false, error: 'refresh interval must be between 2 and 3600 seconds' });
  }

  try {
    const instance = client.getInstance(guildId);
    if (!instance) return sendJson(res, 404, { ok: false, error: 'guild not found' });
    if (!instance.pluginSettings) instance.pluginSettings = {};
    if (!instance.pluginSettings[PLUGIN_NAME]) instance.pluginSettings[PLUGIN_NAME] = {};
    instance.pluginSettings[PLUGIN_NAME].autoRefreshSeconds = `${seconds}`;
    client.setInstance(guildId, instance);
    return sendJson(res, 200, { ok: true, autoRefreshSeconds: seconds });
  }
  catch (err) {
    return sendJson(res, 500, { ok: false, error: err?.message || 'failed to save refresh interval' });
  }
}

async function getTeamData(client, url) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return { ok: false, error: 'guildId required' };
  const rustplus = client.rustplusInstances?.[guildId];
  if (!rustplus?.team) return { ok: false, error: 'team data unavailable' };
  const hosterSteamId = getHosterSteamId(client, guildId);
  const members = [];
  for (const p of (rustplus.team.players || [])) {
    const steamId = p.steamId || null;
    const name = p.name || 'Unknown';
    const isOnline = !!p.isOnline;
    const linkedBmId = await resolveAndStoreBattlemetricsLink(client, guildId, steamId, name, isOnline);
    const cachedBm = getCachedBattlemetricsHours(guildId, steamId, linkedBmId);
    const bmSummary = cachedBm || await fetchBattleMetricsSummary(steamId, name, linkedBmId);
    if (bmSummary) cacheBattlemetricsHours(guildId, steamId, bmSummary);
    members.push({
      name,
      steamId,
      isLeader: rustplus.team.leaderSteamId === p.steamId,
      isOnline,
      avatarUrl: await getSteamAvatarUrl(client, steamId),
      battlemetrics: bmSummary
    });
  }
  return { ok: true, hosterSteamId, hosterIsTeamLeader: hosterSteamId === rustplus.team.leaderSteamId, leaderSteamId: rustplus.team.leaderSteamId, members };
}

function getBattlemetricsCacheKey(guildId, steamId, linkedPlayerId) {
  return `${guildId || 'noguild'}:${steamId || 'nosteam'}:${linkedPlayerId || 'nolink'}`;
}

function getCachedBattlemetricsHours(guildId, steamId, linkedPlayerId) {
  const key = getBattlemetricsCacheKey(guildId, steamId, linkedPlayerId);
  const cached = battlemetricsHoursCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    battlemetricsHoursCache.delete(key);
    return null;
  }
  return cached.value;
}

function cacheBattlemetricsHours(guildId, steamId, summary) {
  const linkedPlayerId = summary?.playerId || null;
  const key = getBattlemetricsCacheKey(guildId, steamId, linkedPlayerId);
  battlemetricsHoursCache.set(key, { value: summary, expiresAt: Date.now() + BATTLEMETRICS_HOURS_CACHE_MS });
}

async function postTeamPromote(client, url, req, res) {
  const guildId = url.searchParams.get('guildId');
  const steamId = String((await readJson(req))?.steamId || '');
  const rustplus = client.rustplusInstances?.[guildId];
  if (!guildId || !steamId || !rustplus?.team) return sendJson(res, 400, { ok: false, error: 'invalid request' });
  const hosterSteamId = getHosterSteamId(client, guildId);
  if (!hosterSteamId || rustplus.team.leaderSteamId !== hosterSteamId) return sendJson(res, 403, { ok: false, error: 'hoster is not team leader' });
  const response = await rustplus.promoteToLeaderAsync(steamId);
  return sendJson(res, 200, { ok: !response?.error, response });
}

async function postTeamKick(client, url, req, res) {
  const guildId = url.searchParams.get('guildId');
  const steamId = String((await readJson(req))?.steamId || '');
  const rustplus = client.rustplusInstances?.[guildId];
  if (!guildId || !steamId || !rustplus?.team) return sendJson(res, 400, { ok: false, error: 'invalid request' });
  const hosterSteamId = getHosterSteamId(client, guildId);
  if (!hosterSteamId || rustplus.team.leaderSteamId !== hosterSteamId) return sendJson(res, 403, { ok: false, error: 'hoster is not team leader' });
  if (typeof rustplus.kickFromTeamAsync !== 'function') return sendJson(res, 400, { ok: false, error: 'kick API unavailable in current rustplus build' });
  const response = await rustplus.kickFromTeamAsync(steamId);
  return sendJson(res, 200, { ok: !response?.error, response });
}

function getHosterSteamId(client, guildId) { return client.getInstance(guildId)?.credentials?.hoster || null; }

async function fetchBattleMetricsSummary(steamId, playerName = '', linkedPlayerId = null) {
  if (!steamId && !playerName) return null;
  try {
    let id = linkedPlayerId || null;
    if (steamId) {
      const pBySteam = await fetch(`https://api.battlemetrics.com/players?filter[search]=${encodeURIComponent(steamId)}&page[size]=1`).then(r => r.ok ? r.json() : null);
      id = pBySteam?.data?.[0]?.id || null;
    }
    if (!id && playerName) {
      const pByName = await fetch(`https://api.battlemetrics.com/players?filter[search]=${encodeURIComponent(playerName)}&page[size]=5`).then(r => r.ok ? r.json() : null);
      id = pByName?.data?.[0]?.id || null;
    }
    if (!id) return { unavailable: true };
    const d = await fetch(`https://api.battlemetrics.com/players/${encodeURIComponent(id)}?include=server`).then(r => r.ok ? r.json() : null);
    if (!d) return { playerId: id, unavailable: true };
    let seconds = 0;
    const includedServers = Array.isArray(d?.included) ? d.included : [];
    for (const server of includedServers) {
      if (server?.type !== 'server') continue;
      const game = server?.relationships?.game?.data?.id;
      if (game && game !== 'rust') continue;
      seconds += Number(server?.meta?.timePlayed || 0);
    }
    if (seconds <= 0) {
      for (const s of d?.data?.relationships?.servers?.data || []) seconds += Number(s?.meta?.timePlayed || 0);
    }
    return { playerId: id, playtimeHours: Math.round((seconds / 3600) * 10) / 10 };
  } catch (_) { return { unavailable: true }; }
}

function getBattlemetricsLinkMap(client, guildId) {
  try {
    const instance = client.getInstance(guildId);
    const settings = instance?.pluginSettings?.[PLUGIN_NAME] || {};
    const raw = settings.teamBattlemetricsLinks;
    if (!raw || typeof raw !== 'string') return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_) { return {}; }
}

function saveBattlemetricsLink(client, guildId, steamId, playerId) {
  if (!steamId || !playerId) return;
  try {
    const instance = client.getInstance(guildId);
    if (!instance.pluginSettings) instance.pluginSettings = {};
    if (!instance.pluginSettings[PLUGIN_NAME]) instance.pluginSettings[PLUGIN_NAME] = {};
    const links = getBattlemetricsLinkMap(client, guildId);
    links[String(steamId)] = String(playerId);
    instance.pluginSettings[PLUGIN_NAME].teamBattlemetricsLinks = JSON.stringify(links);
    client.setInstance(guildId, instance);
  } catch (_) { /* ignore */ }
}

async function resolveAndStoreBattlemetricsLink(client, guildId, steamId, playerName, isOnline) {
  const links = getBattlemetricsLinkMap(client, guildId);
  if (steamId && links[String(steamId)]) return String(links[String(steamId)]);
  if (!isOnline || !playerName) return null;
  try {
    const instance = client.getInstance(guildId);
    const active = instance?.activeServer;
    const bmServerId = active && instance?.serverList?.[active] ? instance.serverList[active].battlemetricsId : null;
    if (!bmServerId) return null;
    const bmLocal = client?.battlemetricsInstances?.[bmServerId];
    if (!bmLocal?.ready || !bmLocal?.players) return null;
    const target = String(playerName).trim().toLowerCase();
    let matchId = null;
    for (const pid of (bmLocal.onlinePlayers || [])) {
      const n = String(bmLocal.players?.[pid]?.name || '').trim().toLowerCase();
      if (n === target) { matchId = pid; break; }
    }
    if (!matchId) return null;
    if (steamId) saveBattlemetricsLink(client, guildId, steamId, matchId);
    return String(matchId);
  } catch (_) { return null; }
}


function parseAnnotations(value) {
  if (!value || typeof value !== 'string') return { markers: [], strokes: [] };
  try {
    const parsed = JSON.parse(value);
    return { markers: Array.isArray(parsed?.markers) ? parsed.markers.slice(0, 200) : [], strokes: Array.isArray(parsed?.strokes) ? parsed.strokes.slice(0, 200) : [] };
  }
  catch (_) { return { markers: [], strokes: [] }; }
}

async function postAnnotations(client, url, req, res) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return sendJson(res, 400, { ok: false, error: 'guildId required' });
  const body = await readJson(req);
  try {
    const instance = client.getInstance(guildId);
    if (!instance) return sendJson(res, 404, { ok: false, error: 'guild not found' });
    if (!instance.pluginSettings) instance.pluginSettings = {};
    if (!instance.pluginSettings[PLUGIN_NAME]) instance.pluginSettings[PLUGIN_NAME] = {};
    const annotations = {
      markers: Array.isArray(body?.markers) ? body.markers.slice(0, 200) : [],
      strokes: Array.isArray(body?.strokes) ? body.strokes.slice(0, 200) : []
    };
    instance.pluginSettings[PLUGIN_NAME].mapAnnotations = JSON.stringify(annotations);
    client.setInstance(guildId, instance);
    return sendJson(res, 200, { ok: true, annotations });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err?.message || 'failed to save annotations' });
  }
}

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

function isAuthorized(url, req) {
  if (!authToken) return false;
  return url.searchParams.get('token') === authToken || req.headers['x-vendor-map-token'] === authToken;
}

function listGuilds(client) {
  const guilds = [];
  try {
    for (const [id, guild] of client.guilds.cache) {
      const rp = client.rustplusInstances?.[id];
      const settings = getPluginSettings(client, id);
      guilds.push({
        id,
        name: guild.name,
        connected: !!(rp && rp.isConnected),
        autoRefreshSeconds: parsePositiveInt(settings.autoRefreshSeconds, 5),
        showOutOfStock: settings.showOutOfStock === true,
        home: parseHomeLocation(settings.homeLocation),
        annotations: parseAnnotations(settings.mapAnnotations)
      });
    }
  }
  catch (_) { /* ignore */ }
  return { ok: true, guilds };
}

async function getVendorMap(client, url, exportOnly = false) {
  const guildId = url.searchParams.get('guildId');
  if (!guildId) return { ok: false, error: 'guildId required' };

  const rustplus = client.rustplusInstances?.[guildId];
  const guild = client.guilds?.cache?.get(guildId);
  const settings = getPluginSettings(client, guildId);
  const home = parseHomeLocation(settings.homeLocation);
  const map = await buildMapPayload(client, guildId, rustplus, exportOnly);
  const vendors = buildVendorPayload(client, rustplus);

  return {
    ok: true,
    guild: { id: guildId, name: guild?.name || guildId, connected: !!(rustplus && rustplus.isConnected) },
    config: {
      autoRefreshSeconds: parsePositiveInt(settings.autoRefreshSeconds, 5),
      showOutOfStock: settings.showOutOfStock === true,
      home,
      annotations: parseAnnotations(settings.mapAnnotations)
    },
    generatedAt: new Date().toISOString(),
    map,
    vendors,
    cheapestByCategory: buildCheapestByCategory(vendors),
    profitTrades: buildProfitTrades(vendors),
    priceChecks: buildPriceChecks(vendors, home),
    summary: summarizeVendors(vendors),
    events: recentEvents.get(guildId) || []
  };
}

async function buildMapPayload(client, guildId, rustplus, exportOnly) {
  const payload = {
    image: null,
    mapSize: rustplus?.info?.correctedMapSize || rustplus?.info?.mapSize || null,
    oceanMargin: 0,
    monuments: [],
    players: []
  };

  try { payload.oceanMargin = rustplus?.map?.oceanMargin || rustplus?.map?._oceanMargin || 0; } catch (_) { /* ignore */ }
  try {
    if (Array.isArray(rustplus?.map?.monuments)) {
      payload.monuments = rustplus.map.monuments.map((m) => ({
        token: m.token,
        name: rustplus.map.monumentInfo?.[m.token]?.clean || m.name || m.token,
        x: m.x,
        y: m.y
      })).filter((m) => typeof m.x === 'number' && typeof m.y === 'number');
    }
  }
  catch (_) { /* ignore */ }

  try {
    if (Array.isArray(rustplus?.team?.players)) {
      payload.players = (await Promise.all(rustplus.team.players.map(async (p) => {
        const steamId = p.steamId ? p.steamId.toString() : null;
        const online = !!p.isOnline;
        const alive = !!p.isAlive;
        return {
          name: p.name,
          steamId,
          avatarUrl: await getSteamAvatarUrl(client, steamId),
          x: p.x,
          y: p.y,
          online,
          alive
        };
      }))).filter((p) => {
        if (!p.online && !p.alive) return false;
        return typeof p.x === 'number' && typeof p.y === 'number';
      });
    }
  }
  catch (_) { /* ignore */ }

  if (!exportOnly) payload.image = getMapImageUrl(guildId);
  return payload;
}


function fetchSteamAvatarFromXml(steamId) {
  return new Promise((resolve) => {
    const url = `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}?xml=1`;
    const req = https.get(url, { headers: { 'user-agent': 'rustplusplus-vendor-map' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const match = body.match(/<avatarFull><!\[CDATA\[(.*?)\]\]><\/avatarFull>/i);
        resolve(match?.[1] || null);
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

async function getSteamAvatarUrl(client, steamId) {
  if (!steamId) return null;
  const now = Date.now();
  const cached = steamAvatarCache.get(steamId);
  if (cached && cached.expiresAt > now) return cached.avatarUrl;

  try {
    const scrapedAvatarUrl = await Scrape.scrapeSteamProfilePicture(client, steamId);
    const xmlAvatarUrl = scrapedAvatarUrl ? null : await fetchSteamAvatarFromXml(steamId);
    const avatarUrl = scrapedAvatarUrl || xmlAvatarUrl || `${UNAVATAR_STEAM_URL}${encodeURIComponent(steamId)}`;
    steamAvatarCache.set(steamId, {
      avatarUrl,
      expiresAt: now + STEAM_AVATAR_CACHE_MS
    });
    return avatarUrl;
  }
  catch (_) {
    const xmlAvatarUrl = await fetchSteamAvatarFromXml(steamId);
    const fallbackAvatarUrl = xmlAvatarUrl || `${UNAVATAR_STEAM_URL}${encodeURIComponent(steamId)}`;
    steamAvatarCache.set(steamId, {
      avatarUrl: fallbackAvatarUrl,
      expiresAt: now + STEAM_AVATAR_RETRY_MS
    });
    return fallbackAvatarUrl;
  }
}

function buildVendorPayload(client, rustplus) {
  const vendingMachines = [];
  const travelingVendors = [];

  try {
    if (Array.isArray(rustplus?.mapMarkers?.vendingMachines)) {
      for (const vendor of rustplus.mapMarkers.vendingMachines) {
        vendingMachines.push(normalizeVendingMachine(client, vendor));
      }
    }
  }
  catch (_) { /* ignore */ }

  try {
    if (Array.isArray(rustplus?.mapMarkers?.travelingVendors)) {
      for (const vendor of rustplus.mapMarkers.travelingVendors) {
        travelingVendors.push({
          id: stableVendorId('traveling', vendor),
          type: 'traveling',
          label: vendor.isHalted ? 'Traveling vendor (halted)' : 'Traveling vendor',
          x: vendor.x,
          y: vendor.y,
          grid: vendor.location?.location || null,
          location: vendor.location?.string || vendor.location?.location || null,
          halted: !!vendor.isHalted,
          orders: []
        });
      }
    }
  }
  catch (_) { /* ignore */ }

  return { vendingMachines, travelingVendors };
}

function normalizeVendingMachine(client, vendor) {
  const orders = [];
  if (Array.isArray(vendor.sellOrders)) {
    for (const order of vendor.sellOrders) {
      const item = getItem(client, order.itemId);
      const currency = getItem(client, order.currencyId);
      orders.push({
        itemId: order.itemId,
        itemName: item.name,
        itemShortName: item.shortName,
        itemCategory: categorizeItem(item.shortName, item.name),
        itemIcon: item.icon,
        itemBlueprint: !!order.itemIsBlueprint,
        currencyId: order.currencyId,
        currencyName: currency.name,
        currencyShortName: currency.shortName,
        currencyIcon: currency.icon,
        currencyBlueprint: !!order.currencyIsBlueprint,
        quantity: order.quantity || 0,
        cost: order.costPerItem || 0,
        stock: order.amountInStock || 0,
        inStock: (order.amountInStock || 0) > 0,
        searchText: [item.name, currency.name, order.itemId, order.currencyId].join(' ').toLowerCase()
      });
    }
  }

  return {
    id: stableVendorId('vending', vendor),
    type: 'vending',
    label: vendor.name || 'Vending machine',
    x: vendor.x,
    y: vendor.y,
    grid: vendor.location?.location || null,
    location: vendor.location?.string || vendor.location?.location || null,
    orders,
    orderCount: orders.length,
    inStockCount: orders.filter((order) => order.inStock).length
  };
}

function getItem(client, itemId) {
  let name = itemId == null ? 'Unknown item' : `Item ${itemId}`;
  let shortName = null;
  let icon = null;
  try {
    if (client.items && itemId != null) {
      name = client.items.getName(itemId) || name;
      shortName = client.items.getShortName?.(itemId) || null;
      icon = getEmbeddedItemIcon(itemId, shortName) || client.items.getImage?.(itemId) || client.items.getIcon?.(itemId) || getLocalItemIcon(itemId, shortName) || null;
    }
  }
  catch (_) { /* ignore */ }
  return { name, shortName, icon };
}

function getEmbeddedItemIcon(itemId, shortName = null) {
  try {
    const iconPath = itemIconState.paths.find((candidate) => Fs.existsSync(candidate));
    if (!iconPath) {
      itemIconState.path = null;
      itemIconState.mtimeMs = 0;
      itemIconState.icons = {};
      return getLocalItemIcon(itemId, shortName);
    }

    const mtimeMs = Fs.statSync(iconPath).mtimeMs;
    if (iconPath !== itemIconState.path || mtimeMs !== itemIconState.mtimeMs) {
      const resolvedPath = require.resolve(iconPath);
      delete require.cache[resolvedPath];
      const icons = require(resolvedPath);
      itemIconState.icons = normalizeIconMap(icons);
      itemIconState.path = iconPath;
      itemIconState.mtimeMs = mtimeMs;
    }

    const rawIcon = findIconValue(itemIconState.icons, itemId, shortName);
    return normalizeItemIconValue(rawIcon) || getLocalItemIcon(itemId, shortName);
  }
  catch (_) {
    return getLocalItemIcon(itemId, shortName);
  }
}

function normalizeIconMap(icons) {
  if (!icons || typeof icons !== 'object') return {};
  if (icons.icons && typeof icons.icons === 'object') return icons.icons;
  if (icons.default && typeof icons.default === 'object') return normalizeIconMap(icons.default);
  return icons;
}

function findIconValue(icons, itemId, shortName = null) {
  const keys = getItemIconKeys(itemId, shortName);
  for (const key of keys) {
    if (icons[key]) return icons[key];
  }
  return null;
}

function getItemIconKeys(itemId, shortName = null) {
  const keys = [];
  if (itemId !== undefined && itemId !== null) keys.push(itemId.toString());
  if (shortName) keys.push(shortName);
  return keys.filter((key, index) => key && keys.indexOf(key) === index);
}

function normalizeItemIconValue(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return null;
  return readLocalIconAsDataUri(trimmed);
}

function getLocalItemIcon(itemId, shortName = null) {
  const index = getLocalItemIconIndex();
  if (!index) return null;

  const names = [];
  for (const key of getItemIconKeys(itemId, shortName)) {
    names.push(key.toLowerCase());
    for (const ext of ['.png', '.webp', '.jpg', '.jpeg']) names.push(`${key.toLowerCase()}${ext}`);
  }

  for (const name of names) {
    if (index.has(name)) return getLocalItemIconUrl(name);
  }
  return null;
}


function getLocalItemIconUrl(name) {
  const tokenPart = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
  return `/item-icons/${encodeURIComponent(name)}${tokenPart}`;
}

function sendLocalItemIcon(url, res) {
  try {
    const rawName = decodeURIComponent(url.pathname.replace(/^\/item-icons\//, '')).toLowerCase();
    const iconPath = getLocalItemIconIndex().get(rawName);
    if (!iconPath) return sendJson(res, 404, { ok: false, error: 'item icon not found' });

    const ext = Path.extname(iconPath).toLowerCase();
    const contentType = ext === '.webp' ? 'image/webp' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' });
    return Fs.createReadStream(iconPath).pipe(res);
  }
  catch (_) {
    return sendJson(res, 404, { ok: false, error: 'item icon not found' });
  }
}

function getLocalItemIconIndex() {
  try {
    if (itemIconState.fileIndex) return itemIconState.fileIndex;
    const index = new Map();
    for (const staticDir of STATIC_FILE_DIRS) {
      for (const subdir of ['', 'item-icons', 'itemIcons', 'icons']) {
        addIconFilesToIndex(Path.join(staticDir, subdir), index, 0);
      }
    }
    itemIconState.fileIndex = index;
    return index;
  }
  catch (_) {
    itemIconState.fileIndex = new Map();
    return itemIconState.fileIndex;
  }
}

function addIconFilesToIndex(dir, index, depth) {
  if (depth > 3 || !Fs.existsSync(dir)) return;
  let entries = [];
  try { entries = Fs.readdirSync(dir, { withFileTypes: true }); }
  catch (_) { return; }

  for (const entry of entries) {
    const entryPath = Path.join(dir, entry.name);
    if (entry.isDirectory()) {
      addIconFilesToIndex(entryPath, index, depth + 1);
      continue;
    }
    if (!entry.isFile() || !/\.(png|webp|jpe?g)$/i.test(entry.name)) continue;
    const basename = entry.name.toLowerCase();
    const stem = basename.replace(/\.(png|webp|jpe?g)$/i, '');
    if (!index.has(basename)) index.set(basename, entryPath);
    if (!index.has(stem)) index.set(stem, entryPath);
  }
}

function readLocalIconAsDataUri(iconPath) {
  try {
    const resolvedPath = resolveLocalIconPath(iconPath);
    if (!resolvedPath) return null;
    const ext = Path.extname(resolvedPath).toLowerCase();
    const mime = ext === '.webp' ? 'image/webp' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${Fs.readFileSync(resolvedPath).toString('base64')}`;
  }
  catch (_) {
    return null;
  }
}

function resolveLocalIconPath(iconPath) {
  const candidates = [];
  if (Path.isAbsolute(iconPath)) candidates.push(iconPath);
  else {
    candidates.push(Path.join(__dirname, '..', iconPath));
    for (const staticDir of STATIC_FILE_DIRS) candidates.push(Path.join(staticDir, iconPath));
  }

  for (const candidate of candidates) {
    const resolved = Path.resolve(candidate);
    if (!isUnderAllowedStaticDir(resolved) || !Fs.existsSync(resolved)) continue;
    const stat = Fs.statSync(resolved);
    if (stat.isFile() && /\.(png|webp|jpe?g)$/i.test(resolved)) return resolved;
  }
  return null;
}

function isUnderAllowedStaticDir(resolvedPath) {
  return STATIC_FILE_DIRS.some((dir) => {
    const resolvedDir = Path.resolve(dir);
    const relative = Path.relative(resolvedDir, resolvedPath);
    return relative && !relative.startsWith('..') && !Path.isAbsolute(relative);
  });
}

function buildCheapestByCategory(vendors) {
  const grouped = new Map();
  for (const vendor of vendors.vendingMachines || []) {
    for (const order of vendor.orders || []) {
      if (!order.inStock) continue;
      const quantity = Math.max(1, order.quantity || 1);
      const unitCost = (order.cost || 0) / quantity;
      const itemKey = `${order.itemId}:${order.itemBlueprint ? 'bp' : 'item'}`;
      const currencyKey = `${order.currencyId}:${order.currencyBlueprint ? 'bp' : 'item'}`;
      const candidate = {
        key: itemKey,
        itemKey,
        currencyKey,
        itemId: order.itemId,
        itemName: order.itemName,
        itemShortName: order.itemShortName,
        itemCategory: order.itemCategory,
        itemBlueprint: order.itemBlueprint,
        itemIcon: order.itemIcon,
        currencyId: order.currencyId,
        currencyName: order.currencyName,
        currencyShortName: order.currencyShortName,
        currencyIcon: order.currencyIcon,
        currencyBlueprint: order.currencyBlueprint,
        quantity: order.quantity || 0,
        cost: order.cost || 0,
        unitCost,
        stock: order.stock || 0,
        vendorId: vendor.id,
        vendorLabel: vendor.label,
        grid: vendor.grid,
        location: vendor.location,
        x: vendor.x,
        y: vendor.y,
        searchText: [order.itemName, order.currencyName, vendor.grid, vendor.location, order.itemShortName, order.currencyShortName].join(' ').toLowerCase()
      };

      if (!grouped.has(itemKey)) {
        grouped.set(itemKey, {
          key: itemKey,
          itemKey,
          itemId: candidate.itemId,
          itemName: candidate.itemName,
          itemShortName: candidate.itemShortName,
          itemCategory: candidate.itemCategory,
          itemBlueprint: candidate.itemBlueprint,
          itemIcon: candidate.itemIcon,
          priceOptionsByCurrency: new Map(),
          searchParts: [candidate.itemName, candidate.itemShortName]
        });
      }

      const group = grouped.get(itemKey);
      group.searchParts.push(candidate.currencyName, candidate.currencyShortName, candidate.grid, candidate.location);
      const current = group.priceOptionsByCurrency.get(currencyKey);
      if (!current || candidate.unitCost < current.unitCost ||
        (candidate.unitCost === current.unitCost && candidate.stock > current.stock)) {
        group.priceOptionsByCurrency.set(currencyKey, candidate);
      }
    }
  }

  const categories = {};
  for (const group of grouped.values()) {
    const priceOptions = Array.from(group.priceOptionsByCurrency.values()).sort((a, b) =>
      a.currencyName.localeCompare(b.currencyName) || a.unitCost - b.unitCost);
    if (!priceOptions.length) continue;
    const best = priceOptions.slice().sort((a, b) => a.unitCost - b.unitCost || b.stock - a.stock)[0];
    const offer = {
      key: group.key,
      itemKey: group.itemKey,
      itemId: group.itemId,
      itemName: group.itemName,
      itemShortName: group.itemShortName,
      itemCategory: group.itemCategory,
      itemBlueprint: group.itemBlueprint,
      itemIcon: group.itemIcon,
      priceOptions,
      priceOptionCount: priceOptions.length,
      quantity: best.quantity,
      cost: best.cost,
      unitCost: best.unitCost,
      currencyId: best.currencyId,
      currencyName: best.currencyName,
      currencyShortName: best.currencyShortName,
      currencyIcon: best.currencyIcon,
      currencyBlueprint: best.currencyBlueprint,
      vendorId: best.vendorId,
      grid: best.grid,
      location: best.location,
      searchText: group.searchParts.join(' ').toLowerCase()
    };
    const category = offer.itemCategory || 'Other';
    if (!categories[category]) categories[category] = [];
    categories[category].push(offer);
  }

  const sorted = {};
  for (const category of Object.keys(categories).sort((a, b) => a.localeCompare(b))) {
    sorted[category] = categories[category].sort((a, b) =>
      a.itemName.localeCompare(b.itemName) || a.unitCost - b.unitCost || a.currencyName.localeCompare(b.currencyName));
  }
  return sorted;
}

function buildProfitTrades(vendors) {
  const orders = [];
  for (const vendor of vendors.vendingMachines || []) {
    for (const order of vendor.orders || []) {
      if (!order.inStock) continue;
      orders.push({
        vendorId: vendor.id,
        vendorLabel: vendor.label,
        grid: vendor.grid,
        location: vendor.location,
        x: vendor.x,
        y: vendor.y,
        itemId: order.itemId,
        itemName: order.itemName,
        itemBlueprint: order.itemBlueprint,
        currencyId: order.currencyId,
        currencyName: order.currencyName,
        currencyBlueprint: order.currencyBlueprint,
        quantity: Math.max(1, order.quantity || 1),
        cost: Math.max(1, order.cost || 1),
        stock: order.stock || 0,
        searchText: [order.itemName, order.currencyName, vendor.grid, vendor.location].join(' ').toLowerCase()
      });
    }
  }

  const routes = [];
  for (const buy of orders) {
    for (const sell of orders) {
      if (buy.vendorId === sell.vendorId) continue;
      if (buy.itemId !== sell.currencyId || buy.currencyId !== sell.itemId) continue;
      if (!!buy.itemBlueprint !== !!sell.currencyBlueprint || !!buy.currencyBlueprint !== !!sell.itemBlueprint) continue;

      const buyCostPerItem = buy.cost / buy.quantity;
      const sellReturnPerItem = sell.quantity / sell.cost;
      const profitPerItem = sellReturnPerItem - buyCostPerItem;
      if (profitPerItem <= 0) continue;

      const tradableItemCount = Math.min(buy.stock * buy.quantity, sell.stock * sell.cost);
      const totalProfit = Math.floor(profitPerItem * tradableItemCount);
      if (totalProfit <= 0) continue;

      routes.push({
        buyVendorId: buy.vendorId,
        sellVendorId: sell.vendorId,
        buyGrid: buy.grid,
        sellGrid: sell.grid,
        buyLocation: buy.location,
        sellLocation: sell.location,
        itemId: buy.itemId,
        itemName: buy.itemName,
        currencyId: buy.currencyId,
        currencyName: buy.currencyName,
        buyQuantity: buy.quantity,
        buyCost: buy.cost,
        sellQuantity: sell.quantity,
        sellCost: sell.cost,
        profitPerItem,
        totalProfit,
        tradableItemCount,
        routeText: `Buy ${buy.quantity} ${buy.itemName} for ${buy.cost} ${buy.currencyName}, then trade ${sell.cost} ${buy.itemName} for ${sell.quantity} ${buy.currencyName}`,
        searchText: [buy.searchText, sell.searchText, buy.itemName, buy.currencyName].join(' ').toLowerCase()
      });
    }
  }

  return routes.sort((a, b) => b.totalProfit - a.totalProfit || b.profitPerItem - a.profitPerItem).slice(0, 50);
}

function categorizeItem(shortName, name) {
  const value = `${shortName || ''} ${name || ''}`.toLowerCase();
  if (hasAny(value, ['ammo', 'arrow', 'rocket', 'grenade', 'shell', 'incendiary', 'hv.'])) return 'Ammo & Explosives';
  if (hasAny(value, ['rifle', 'pistol', 'smg', 'shotgun', 'lmg', 'launcher', 'm249', 'revolver', 'python', 'eoka', 'crossbow', 'bow.', 'weapon.', 'flamethrower', 'nailgun'])) return 'Guns & Weapons';
  if (hasAny(value, ['attire.', 'clothing', 'hoodie', 'pants', 'boots', 'gloves', 'helmet', 'facemask', 'jacket', 'shirt', 'kilt', 'roadsign', 'hazmat', 'armor', 'vest', 'mask', 'sunglasses'])) return 'Clothing & Armor';
  if (hasAny(value, ['component', 'gears', 'spring', 'riflebody', 'semibody', 'smgbody', 'tarp', 'rope', 'sewing', 'sheetmetal', 'techparts', 'propanetank', 'metalblade', 'metalspring', 'roadsigns', 'fuse', 'ducttape'])) return 'Components';
  if (hasAny(value, ['building', 'wall.', 'floor.', 'door.', 'barricade', 'ladder', 'gate', 'shutter', 'lock.', 'cupboard', 'foundation', 'embrasure', 'furnace', 'box.', 'storage', 'sign.', 'planter', 'trap', 'turret'])) return 'Building & Deployables';
  if (hasAny(value, ['wood', 'stones', 'metal.refined', 'metal.fragments', 'sulfur', 'charcoal', 'lowgradefuel', 'cloth', 'leather', 'scrap', 'hq.metal', 'crude.oil', 'gunpowder'])) return 'Resources';
  if (hasAny(value, ['tool.', 'pickaxe', 'hatchet', 'salvaged', 'jackhammer', 'chainsaw', 'hammer', 'toolgun', 'wiretool', 'spraycan', 'binoculars'])) return 'Tools';
  if (hasAny(value, ['medical', 'syringe', 'bandage', 'largemedkit', 'antirad', 'radiation', 'blood'])) return 'Medical';
  if (hasAny(value, ['food', 'apple', 'berry', 'meat', 'water', 'fish', 'corn', 'pumpkin', 'mushroom', 'chocolate', 'granolabar', 'can.', 'pie.'])) return 'Food & Farming';
  if (hasAny(value, ['electric', 'battery', 'switch', 'generator', 'solar', 'wire', 'smart.', 'computerstation', 'camera', 'rf.', 'counter', 'timer', 'sensor', 'light.'])) return 'Electrical';
  if (hasAny(value, ['vehicle', 'modularcar', 'car.', 'engine.', 'horse', 'snowmobile', 'submarine', 'boat', 'kayak', 'mlrs', 'drone'])) return 'Vehicles';
  return 'Other';
}

function hasAny(value, needles) {
  return needles.some((needle) => value.includes(needle));
}

function parseHomeLocation(value) {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split(/[ ,]+/).map((part) => Number(part.trim())).filter((part) => Number.isFinite(part));
  if (parts.length < 2) return null;
  return { x: parts[0], y: parts[1], radius: parts[2] && parts[2] > 0 ? parts[2] : 100 };
}

function buildPriceChecks(vendors, home) {
  if (!home) return [];
  const machines = vendors.vendingMachines || [];
  const homeVendors = machines.filter((vendor) => getDistance(home.x, home.y, vendor.x, vendor.y) <= home.radius);
  if (!homeVendors.length) return [];

  const checks = [];
  for (const homeVendor of homeVendors) {
    for (const homeOrder of homeVendor.orders || []) {
      const homeUnitCost = (homeOrder.cost || 0) / Math.max(1, homeOrder.quantity || 1);
      for (const competitor of machines) {
        if (homeVendors.some((vendor) => vendor.id === competitor.id)) continue;
        for (const competitorOrder of competitor.orders || []) {
          if (!competitorOrder.inStock) continue;
          if (homeOrder.itemId !== competitorOrder.itemId || homeOrder.currencyId !== competitorOrder.currencyId) continue;
          if (!!homeOrder.itemBlueprint !== !!competitorOrder.itemBlueprint || !!homeOrder.currencyBlueprint !== !!competitorOrder.currencyBlueprint) continue;
          const competitorUnitCost = (competitorOrder.cost || 0) / Math.max(1, competitorOrder.quantity || 1);
          if (competitorUnitCost >= homeUnitCost) continue;
          const cheaperBy = homeUnitCost - competitorUnitCost;
          checks.push({
            key: `${homeVendor.id}:${competitor.id}:${homeOrder.itemId}:${homeOrder.currencyId}`,
            homeVendorId: homeVendor.id,
            competitorVendorId: competitor.id,
            itemId: homeOrder.itemId,
            itemName: homeOrder.itemName,
            itemIcon: homeOrder.itemIcon,
            currencyId: homeOrder.currencyId,
            currencyName: homeOrder.currencyName,
            currencyIcon: homeOrder.currencyIcon,
            homeGrid: homeVendor.grid,
            competitorGrid: competitor.grid,
            homeLocation: homeVendor.location,
            competitorLocation: competitor.location,
            homeX: homeVendor.x,
            homeY: homeVendor.y,
            competitorX: competitor.x,
            competitorY: competitor.y,
            homeQuantity: homeOrder.quantity || 0,
            homeCost: homeOrder.cost || 0,
            competitorQuantity: competitorOrder.quantity || 0,
            competitorCost: competitorOrder.cost || 0,
            homeUnitCost,
            competitorUnitCost,
            cheaperBy,
            cheaperPercent: homeUnitCost > 0 ? (cheaperBy / homeUnitCost) * 100 : 0,
            distanceFromHome: Math.round(getDistance(home.x, home.y, competitor.x, competitor.y)),
            searchText: [homeOrder.itemName, homeOrder.currencyName, homeVendor.grid, competitor.grid, homeVendor.location, competitor.location].join(' ').toLowerCase()
          });
        }
      }
    }
  }

  return checks.sort((a, b) => b.cheaperPercent - a.cheaperPercent || b.cheaperBy - a.cheaperBy).slice(0, 50);
}

function getDistance(x1, y1, x2, y2) {
  const dx = (x1 || 0) - (x2 || 0);
  const dy = (y1 || 0) - (y2 || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function summarizeVendors(vendors) {
  const machines = vendors.vendingMachines || [];
  const traveling = vendors.travelingVendors || [];
  const orders = machines.flatMap((vendor) => vendor.orders || []);
  const inStock = orders.filter((order) => order.inStock);
  return {
    vendingMachineCount: machines.length,
    travelingVendorCount: traveling.length,
    orderCount: orders.length,
    inStockOrderCount: inStock.length,
    uniqueItems: new Set(inStock.map((order) => order.itemName)).size,
    uniqueCurrencies: new Set(inStock.map((order) => order.currencyName)).size
  };
}

function getMapImageFile(guildId) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(guildId || ''))) return null;
  const candidates = [
    Path.join(__dirname, '..', 'maps', `${guildId}_map_full.png`),
    Path.join(__dirname, '..', 'maps', `${guildId}_map_clean.png`),
    Path.join(__dirname, '..', 'maps', `${guildId}_map.png`)
  ];
  for (const file of candidates) {
    try {
      if (Fs.existsSync(file)) {
        const stat = Fs.statSync(file);
        if (stat.isFile()) return { file, mtimeMs: stat.mtimeMs, size: stat.size };
      }
    }
    catch (_) { /* ignore */ }
  }
  return null;
}

function getMapImageUrl(guildId) {
  const image = getMapImageFile(guildId);
  if (!image) return null;
  const version = `${Math.round(image.mtimeMs)}-${image.size}`;
  const tokenPart = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
  return `/map-image/${encodeURIComponent(guildId)}.png?v=${encodeURIComponent(version)}${tokenPart}`;
}

function sendMapImage(url, req, res) {
  try {
    const guildId = decodeURIComponent(url.pathname.replace(/^\/map-image\//, '').replace(/\.png$/i, ''));
    if (!guildId) return sendJson(res, 404, { ok: false, error: 'map image not found' });
    const image = getMapImageFile(guildId);
    if (!image) return sendJson(res, 404, { ok: false, error: 'map image not found' });
    const etag = `W/"${Math.round(image.mtimeMs)}-${image.size}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { 'Cache-Control': 'public, max-age=31536000, immutable', 'ETag': etag });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': etag
    });
    return Fs.createReadStream(image.file).pipe(res);
  }
  catch (_) {
    return sendJson(res, 404, { ok: false, error: 'map image not found' });
  }
}

function stableVendorId(prefix, vendor) {
  const x = Number.isFinite(vendor?.x) ? Math.round(vendor.x) : 'x';
  const y = Number.isFinite(vendor?.y) ? Math.round(vendor.y) : 'y';
  return `${prefix}-${vendor?.id || `${x}-${y}`}`;
}

function rememberEvent(guildId, text) {
  if (!guildId || !text) return;
  const events = recentEvents.get(guildId) || [];
  events.unshift({ time: new Date().toISOString(), text });
  recentEvents.set(guildId, events.slice(0, 30));
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function generateToken() {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function sendHtml(res, status, html) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
function sendCss(res, status, css) { res.writeHead(status, { 'Content-Type': 'text/css; charset=utf-8' }); res.end(css); }
function sendJs(res, status, js) { res.writeHead(status, { 'Content-Type': 'application/javascript; charset=utf-8' }); res.end(js); }
function sendSvg(res, status, svg) { res.writeHead(status, { 'Content-Type': 'image/svg+xml; charset=utf-8' }); res.end(svg); }
function sendJson(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }

function htmlPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Rust++ Vendor Map</title>
  <link rel="icon" href="/favicon.svg" />
  <link rel="stylesheet" href="/app.css" />
</head>
<body>
  <header class="topbar">
    <div class="brand"><span class="brand-icon">🛒</span><span>Rust++ Vendor Map</span></div>
    <div class="toolbar">
      <select id="guildSelect" class="input"></select>
      <button id="copyLink" class="btn" title="Copy link">🔗 Copy</button>
      <button id="exportJson" class="btn" title="Export JSON">⬇️ JSON</button>
      <span id="status" class="status">Loading…</span>
    </div>
    <nav class="desktop-tabs" aria-label="Main sections">
      <button class="desktop-tab active" data-view="map">🗺️ Vendor Map</button>
      <button class="desktop-tab" data-view="team">👥 Team</button>
    </nav>
    <nav class="mobile-tabs" aria-label="Vendor map sections">
      <button class="mobile-tab active" data-panel="map" title="Map" aria-label="Map">🗺️</button>
      <button class="mobile-tab" data-panel="controls" title="Settings" aria-label="Settings">⚙️</button>
      <button class="mobile-tab" data-panel="prices" title="Prices" aria-label="Prices">💰</button>
      <button class="mobile-tab" data-panel="vendors" title="Vendors" aria-label="Vendors">🛒</button>
      <button class="mobile-tab" data-panel="team" title="Team" aria-label="Team">👥</button>
      <button class="mobile-tab" data-panel="home" title="Home" aria-label="Home">⌂</button>
      <button class="mobile-tab" data-panel="events" title="Events" aria-label="Events">⚡</button>
    </nav>
  </header>
  <main class="layout">
    <aside class="sidebar">
      <section class="card stats" id="stats" data-mobile-panel="controls"></section>
      <section class="card controls" data-mobile-panel="controls"><h2>Quick filters</h2>
        <label>Search items, currencies, grids, vendors
          <input id="search" class="input full" placeholder="e.g. sulfur, scrap, D12" autocomplete="off" />
        </label>
        <div class="checks">
          <label><input id="showVending" type="checkbox" checked /> Vending machines</label>
          <label><input id="showTraveling" type="checkbox" checked /> Traveling vendor</label>
          <label><input id="showOutOfStock" type="checkbox" /> Hide out-of-stock orders</label>
          <label><input id="hideEmptyVending" type="checkbox" /> Hide shops with no sell listings</label>
          <label><input id="showPlayers" type="checkbox" checked /> Team players</label>
          <label><input id="showMonuments" type="checkbox" /> Monuments</label>
        </div>
        <div class="map-buttons">
          <button id="fitMap" class="btn full">Fit map</button>
          <button id="refreshNow" class="btn full primary">Refresh now</button>
        </div>
        <details class="settings-collapse"><summary>Advanced settings</summary><label class="refresh-setting">Refresh interval (seconds)
          <input id="refreshSeconds" class="input full" type="number" min="2" max="3600" step="1" />
        </label>
        <button id="saveRefresh" class="btn full">Save refresh interval</button><label style="display:block;margin-top:10px">Hide items (comma-separated names or shortnames)<input id="hiddenItems" class="input full" placeholder="example: skull,twitch,rug.bear" /></label></details>
      </section>
      <section class="card" data-mobile-panel="home">
        <h2>Home location</h2>
        <div class="home-grid">
          <input id="homeX" class="input" placeholder="X" />
          <input id="homeY" class="input" placeholder="Y" />
          <input id="homeRadius" class="input" placeholder="Radius" />
        </div>
        <div class="map-buttons">
          <button id="homeFromSelected" class="btn full">Use selected vendor</button>
          <button id="saveHome" class="btn full primary">Save home</button>
        </div>
        <button id="clearHome" class="btn full">Clear home</button><div class="map-buttons" style="margin-top:8px"><button id="addMarkerAtCenter" class="btn full">Add marker at center</button><button id="toggleDraw" class="btn full">Start drawing</button></div><button id="clearDrawings" class="btn full" style="margin-top:8px">Clear drawings/markers</button>
        <div id="homeStatus" class="muted">No home set.</div>
      </section>
      <section class="card" data-mobile-panel="prices">
        <h2>Price undercuts</h2>
        <div id="priceCheckList" class="price-check-list"></div>
      </section>
      <section class="card" data-mobile-panel="prices">
        <h2>Cheapest by category</h2>
        <div id="cheapestList" class="cheapest-list"></div>
      </section>
      <section class="card" data-mobile-panel="prices">
        <h2>Profit trades</h2>
        <div id="profitList" class="profit-list"></div>
      </section>
      <section class="card" data-mobile-panel="vendors">
        <h2>Vendors</h2>
        <button id="toggleVendorList" class="btn full">Show vendor list</button>
        <div id="vendorList" class="vendor-list" style="display:none"></div>
      </section>
      <section class="card" data-mobile-panel="events">
        <h2>Recent events</h2>
        <div id="eventList" class="events muted">No events yet.</div>
      </section>
    </aside>
    <section class="map-panel" data-mobile-panel="map">
      <div class="map-help">Mouse wheel / pinch to zoom · Drag to pan · Click a marker for details</div><div class="draw-overlay"><input id="lineColor" type="color" value="#fbbf24" title="Line color" /><button id="toggleDrawOverlay" class="btn">✏️</button><button id="toggleEraserOverlay" class="btn">🩹</button></div>
      <div id="map" class="map">
        <img id="mapImage" alt="Rust map" />
        <div id="markerLayer" class="marker-layer"></div>
        <div id="emptyMap" class="empty">Map image is not available yet. Vendor lists still work once Rust+ marker data is present.</div>
      </div>
    </section>
    <aside id="details" class="details closed">
      <button id="closeDetails" class="close" title="Close">×</button>
      <div id="detailsBody"></div>
    </aside>
  </main>
  <main class="team-page" data-view="team" style="display:none">
    <section class="card">
      <h2>Team management</h2>
      <div id="teamList" class="vendor-list"></div>
    </section>
  </main>
  <div id="toast" class="toast" hidden></div>
  <script src="/app.js"></script>
</body>
</html>`;
}

function appCss() {
  return `:root{color-scheme:dark;--bg:#101217;--panel:#181c24;--panel2:#202633;--text:#f5f1eb;--muted:#9da6b5;--line:#303849;--accent:#ce412b;--good:#4ade80;--warn:#fbbf24;--blue:#60a5fa}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Arial,sans-serif}.topbar{height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--line);background:rgba(16,18,23,.94);position:sticky;top:0;z-index:10}.brand{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:800}.brand-icon{font-size:24px}.toolbar{display:flex;align-items:center;gap:8px}.desktop-tabs{display:flex;gap:8px}.desktop-tab{border:1px solid var(--line);background:#202633;color:var(--text);border-radius:9px;padding:8px 10px;cursor:pointer}.desktop-tab.active{background:var(--accent);border-color:#e15b45}.mobile-tabs{display:none}.layout{display:grid;grid-template-columns:360px minmax(0,1fr) 380px;height:calc(100vh - 58px);min-height:540px}.team-page{padding:16px;max-width:1100px;margin:0 auto}.sidebar,.details{overflow:auto;background:var(--panel);border-right:1px solid var(--line);padding:14px}.details{border-left:1px solid var(--line);border-right:0;position:relative}.details.closed{display:none}.map-panel{position:relative;min-width:0;background:#0c0f14}.map{position:absolute;inset:0;overflow:hidden;cursor:grab;touch-action:none;overscroll-behavior:contain}.map.dragging{cursor:grabbing}.map-help{position:absolute;top:12px;left:12px;z-index:3;background:rgba(0,0,0,.55);padding:8px 10px;border-radius:10px;color:var(--muted);backdrop-filter:blur(8px)}#mapImage{position:absolute;left:0;top:0;transform-origin:0 0;user-select:none;pointer-events:none}.marker-layer{position:absolute;left:0;top:0;transform-origin:0 0}.draw-layer{position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none}.draw-overlay{position:absolute;top:12px;right:12px;z-index:4;display:flex;gap:6px}.draw-overlay .btn{padding:8px 10px}.draw-overlay input[type="color"]{width:38px;height:38px;padding:0;border:1px solid var(--line);border-radius:8px;background:#111827}.draw-overlay .btn.active{border-color:#fbbf24;box-shadow:0 0 0 2px rgba(251,191,36,.25)}.empty{position:absolute;inset:auto 24px 24px 24px;padding:12px 14px;border:1px dashed var(--line);border-radius:12px;color:var(--muted);background:rgba(24,28,36,.85)}.card{background:var(--panel2);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px}.card h2{margin:0 0 10px;font-size:15px}.input{background:#0d1118;color:var(--text);border:1px solid var(--line);border-radius:9px;padding:9px 10px;outline:0}.input:focus{border-color:var(--accent)}.full{width:100%}.btn{border:1px solid var(--line);background:#252c3a;color:var(--text);border-radius:9px;padding:9px 11px;cursor:pointer}.btn:hover{border-color:#566174}.btn.primary{background:var(--accent);border-color:#e15b45}.status,.muted{color:var(--muted)}.checks{display:grid;gap:8px;margin:12px 0}.checks label{display:flex;gap:8px;align-items:center}.map-buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px}.stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}.stat{padding:9px;border:1px solid var(--line);border-radius:10px;background:#131822}.stat b{display:block;font-size:20px}.stat span{color:var(--muted);font-size:12px}.vendor-list,.cheapest-list,.profit-list,.price-check-list{display:grid;gap:8px}.category-block{border:1px solid var(--line);border-radius:12px;background:#151a23;overflow:hidden}.category-head{display:flex;justify-content:space-between;gap:8px;padding:9px 10px;background:#111722;font-weight:800}.cheap-row,.profit-row,.price-check-row{display:grid;grid-template-columns:38px minmax(0,1fr);gap:9px;padding:9px 10px;border-top:1px solid var(--line);cursor:pointer}.cheap-row:hover,.profit-row:hover,.price-check-row:hover,.cheap-option:hover{background:#1b2230}.shop-icon{position:relative;width:36px;height:36px;aspect-ratio:1/1;border-radius:7px;display:flex;align-items:center;justify-content:center;background:#0d1118;border:1px solid var(--line);font-size:18px;line-height:1;overflow:hidden;flex:0 0 36px}.shop-icon.stock-in{border-color:rgba(74,222,128,.85);box-shadow:0 0 0 1px rgba(74,222,128,.18)}.shop-icon.stock-out{border-color:rgba(239,68,68,.85);box-shadow:0 0 0 1px rgba(239,68,68,.18)}.shop-icon img{width:100%;height:100%;object-fit:cover;display:block}.stock-badge{position:absolute;right:-2px;bottom:-2px;min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:#111827;border:1px solid rgba(255,255,255,.75);color:#fff;font-size:10px;line-height:13px;font-weight:900;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.55);pointer-events:none}.shop-icon.stock-out .stock-badge{background:#7f1d1d}.cheap-main,.profit-main,.price-check-main{min-width:0}.cheap-title,.cheap-cost,.profit-title,.profit-route,.price-check-title,.price-check-route,.cheap-option-title,.cheap-option-meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cheap-title,.profit-title,.price-check-title{font-weight:700}.cheap-cost,.profit-route,.price-check-route{color:var(--muted);font-size:12px}.profit-gain,.price-check-location{color:var(--good);font-size:12px;font-weight:800}.cheap-options{grid-column:1/-1;margin:2px 0 0 46px;border-left:2px solid var(--line);display:grid;gap:2px}.cheap-option{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:7px 9px;border-radius:8px;cursor:pointer}.cheap-option-title{font-weight:700;font-size:12px}.cheap-option-meta{color:var(--muted);font-size:12px}.price-check-location{color:var(--warn)}.home-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:8px}.home-grid .input{width:100%;min-width:0}#homeRadius{grid-column:1/-1}#homeStatus{margin-top:8px}.refresh-setting{display:block;margin-top:10px}.refresh-setting .input{margin-top:5px}.vendor-row{border:1px solid var(--line);border-radius:12px;padding:10px;background:#151a23;cursor:pointer}.vendor-row:hover,.vendor-row.active{border-color:var(--accent)}.vendor-title{display:flex;justify-content:space-between;gap:8px;font-weight:700}.vendor-meta{color:var(--muted);font-size:12px;margin-top:3px}.pill{display:inline-flex;align-items:center;border-radius:999px;padding:2px 7px;font-size:12px;background:#2b3342;color:var(--muted);margin:2px 4px 0 0}.pill.good{color:#062411;background:var(--good)}.pill.warn{color:#271b00;background:var(--warn)}.pill.danger{color:#2a0606;background:#ef4444}.marker{position:absolute;width:28px;height:28px;aspect-ratio:1/1;transform:translate(-50%,-50%);border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 3px 14px rgba(0,0,0,.6);cursor:pointer;font-size:15px;z-index:2;line-height:1;overflow:visible;padding:0;background-position:center;background-repeat:no-repeat;background-size:cover}.marker:hover,.marker:focus,.marker:focus-within{z-index:1000}.marker.vending{width:38px;height:38px;background:transparent;border:0;border-radius:0;box-shadow:none}.marker.vending.stock-in .marker-image,.marker.cluster.stock-in .marker-image{filter:drop-shadow(0 0 7px rgba(74,222,128,.95)) drop-shadow(0 3px 8px rgba(0,0,0,.75))}.marker.vending.stock-out .marker-image,.marker.cluster.stock-out .marker-image{filter:drop-shadow(0 0 7px rgba(248,113,113,.95)) drop-shadow(0 3px 8px rgba(0,0,0,.75))}.marker.vending.stock-in::after,.marker.vending.stock-out::after,.marker.cluster.stock-in::after,.marker.cluster.stock-out::after{content:'';position:absolute;right:1px;bottom:1px;width:11px;height:11px;border-radius:50%;border:2px solid #0c0f14;background:var(--good);z-index:3}.marker.vending.stock-out::after,.marker.cluster.stock-out::after{background:#ef4444}.marker.vending .marker-label{top:35px}.marker.home{width:30px;height:30px;background:var(--good);color:#062411;border-radius:50%;font-weight:900;font-size:14px}.marker.cluster{width:40px;height:40px;background:transparent;border:0;border-radius:0;box-shadow:none;font-weight:900}.marker-image{width:100%;height:100%;display:block;object-fit:contain;filter:drop-shadow(0 3px 8px rgba(0,0,0,.75))}.marker-image.avatar-image{aspect-ratio:1/1;object-fit:cover;border-radius:50%;filter:none}.cluster-count{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:1000;line-height:1;text-shadow:0 2px 0 #000,0 -2px 0 #000,2px 0 0 #000,-2px 0 0 #000,0 3px 8px #000}.cluster-popover,.vendor-popover{display:none;position:absolute;left:50%;top:calc(100% - 2px);transform:translateX(-50%) scale(var(--inverse-scale,1));transform-origin:top center;width:380px;max-height:360px;overflow-y:auto;overscroll-behavior:contain;background:#111722;border:1px solid var(--line);border-radius:12px;padding:10px;text-align:left;box-shadow:0 12px 42px rgba(0,0,0,.65);z-index:1001}.marker.cluster:hover .cluster-popover,.marker.cluster:focus .cluster-popover,.marker.cluster:focus-within .cluster-popover,.marker.cluster.selected .cluster-popover,.marker.vending:hover .vendor-popover,.marker.vending:focus .vendor-popover,.marker.vending:focus-within .vendor-popover,.marker.vending.selected .vendor-popover{display:block}.cluster-title{font-weight:900;margin-bottom:6px}.cluster-vendor{border-top:1px solid var(--line);padding:7px 0}.cluster-vendor:first-of-type{border-top:0}.cluster-items{display:grid;gap:4px;max-height:170px;overflow:auto}.cluster-head,.cluster-item{display:grid;grid-template-columns:minmax(0,1fr) 26px minmax(0,1fr);align-items:center;gap:8px;color:var(--muted);font-size:12px}.cluster-head{position:sticky;top:0;z-index:1;background:#111722;color:var(--text);font-weight:800;padding:2px 0 4px}.trade-cell{display:flex;align-items:center;gap:6px;min-width:0}.trade-cell span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.trade-arrow{text-align:center;color:var(--muted);font-weight:800}.mini-icon{width:22px;height:22px;border-radius:5px;background:#0d1118;border:1px solid var(--line);display:inline-flex;align-items:center;justify-content:center;overflow:hidden}.mini-icon img{width:100%;height:100%;object-fit:cover;display:block}.mini-icon.placeholder{color:var(--muted);font-size:10px}.marker.traveling{background:var(--warn);color:#211400}.marker.player{background:var(--blue)}.marker.player.avatar{width:34px;height:34px;aspect-ratio:1/1;background:#111722;color:transparent;border-radius:50%;overflow:visible}.marker.monument{background:#6b7280;font-size:11px}.marker.dim{opacity:.22}.marker.selected{outline:3px solid white;z-index:5}.marker-label{position:absolute;left:50%;top:29px;transform:translateX(-50%);white-space:nowrap;background:rgba(0,0,0,.72);border-radius:999px;padding:2px 7px;font-size:12px;color:white;pointer-events:none}.close{position:absolute;right:14px;top:12px;background:transparent;color:var(--muted);border:0;font-size:28px;cursor:pointer}.details h2{margin:14px 36px 2px 0}.order{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;padding:9px;border:1px solid var(--line);border-radius:10px;margin:8px 0;background:#141923}.order.out{opacity:.5}.arrow{color:var(--muted)}.item{min-width:0}.item b{display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.item b .shop-icon{width:34px;height:34px;flex-basis:34px}.item b span{min-width:0;overflow:hidden;text-overflow:ellipsis}.item span{font-size:12px;color:var(--muted)}.cluster-detail-vendor{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}.cluster-detail-vendor h3{font-size:14px;margin:0 0 6px}.events{display:grid;gap:7px}.event{border-left:3px solid var(--accent);padding-left:8px}.toast{position:fixed;right:18px;bottom:18px;padding:10px 13px;background:#111827;border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);z-index:20}@media(max-width:1100px){.layout{grid-template-columns:320px 1fr}.details{position:fixed;right:0;top:58px;bottom:0;width:min(390px,94vw);z-index:9;box-shadow:-20px 0 45px rgba(0,0,0,.45)}}@media(max-width:760px){.desktop-tabs{display:none}body{overflow:hidden}.topbar{height:auto;min-height:58px;align-items:flex-start;flex-direction:column;padding:8px;gap:8px}.brand{width:100%;font-size:16px}.brand-icon{font-size:20px}.toolbar{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px}.toolbar .btn{padding:8px}.toolbar .status{grid-column:1/-1;font-size:12px;min-height:18px}.mobile-tabs{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;width:100%}.mobile-tab{border:1px solid var(--line);background:#202633;color:var(--text);border-radius:12px;min-height:42px;font-size:20px;cursor:pointer}.mobile-tab.active{background:var(--accent);border-color:#e15b45;box-shadow:0 0 0 2px rgba(206,65,43,.25)}.layout{display:block;height:calc(100dvh - 148px);min-height:0}.sidebar,.details,.map-panel,.team-page{display:none}.map-panel{height:100%}body[data-mobile-panel="map"] .map-panel{display:block}body[data-mobile-panel="controls"] .sidebar,body[data-mobile-panel="prices"] .sidebar,body[data-mobile-panel="vendors"] .sidebar,body[data-mobile-panel="home"] .sidebar,body[data-mobile-panel="events"] .sidebar,body[data-mobile-panel="team"] .team-page{display:block;height:100%;overflow:auto;border:0;padding:10px}.sidebar .card{display:none;margin-bottom:10px}body[data-mobile-panel="controls"] .sidebar [data-mobile-panel="controls"],body[data-mobile-panel="prices"] .sidebar [data-mobile-panel="prices"],body[data-mobile-panel="vendors"] .sidebar [data-mobile-panel="vendors"],body[data-mobile-panel="home"] .sidebar [data-mobile-panel="home"],body[data-mobile-panel="events"] .sidebar [data-mobile-panel="events"]{display:block}.details:not(.closed){display:block;position:fixed;top:148px;left:0;right:0;bottom:0;width:100%;z-index:30;border-left:0;box-shadow:0 -20px 45px rgba(0,0,0,.45)}.map-help{top:8px;left:8px;right:8px;font-size:12px;text-align:center}.empty{left:12px;right:12px;bottom:12px}.map-buttons{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
}

function appJs() {
  return `(() => {
  const VENDING_MACHINE_MARKER_IMAGE = ${JSON.stringify(VENDING_MACHINE_MARKER_IMAGE)};
  const STACKED_VENDING_MACHINE_MARKER_IMAGE = ${JSON.stringify(STACKED_VENDING_MACHINE_MARKER_IMAGE)};
  const qs = new URLSearchParams(location.search);
  const token = qs.get('token') || '';
  const state = { data:null, selectedId:null, scale:1, x:0, y:0, imgW:0, imgH:0, mapSize:null, ocean:0, timer:null, expandedCheapest:{}, popoverScrollTop:0, hiddenItems:new Set(), vendorListVisible:false, annotations:{markers:[],strokes:[]}, drawMode:false, eraserMode:false, currentStroke:null, drawing:false, annotationsDirty:false, lineColor:'#fbbf24', teamData:null, teamUpdatedAt:0 };
  const els = {
    guild: document.getElementById('guildSelect'), status: document.getElementById('status'), stats: document.getElementById('stats'),
    search: document.getElementById('search'), showVending: document.getElementById('showVending'), showTraveling: document.getElementById('showTraveling'),
    showOutOfStock: document.getElementById('showOutOfStock'), hideEmptyVending: document.getElementById('hideEmptyVending'), showPlayers: document.getElementById('showPlayers'), showMonuments: document.getElementById('showMonuments'),
    vendorList: document.getElementById('vendorList'), teamList: document.getElementById('teamList'), cheapestList: document.getElementById('cheapestList'), profitList: document.getElementById('profitList'), priceCheckList: document.getElementById('priceCheckList'), events: document.getElementById('eventList'), map: document.getElementById('map'), img: document.getElementById('mapImage'),
    layer: document.getElementById('markerLayer'), drawCanvas: null, empty: document.getElementById('emptyMap'), details: document.getElementById('details'), detailsBody: document.getElementById('detailsBody'), toast: document.getElementById('toast'), homeX: document.getElementById('homeX'), homeY: document.getElementById('homeY'), homeRadius: document.getElementById('homeRadius'), homeStatus: document.getElementById('homeStatus'), refreshSeconds: document.getElementById('refreshSeconds'), hiddenItems: document.getElementById('hiddenItems'), toggleVendorList: document.getElementById('toggleVendorList'), lineColor: document.getElementById('lineColor')
  };
  const headers = { 'x-vendor-map-token': token };

  function api(path){ return fetch(path + (path.includes('?')?'&':'?') + 'token=' + encodeURIComponent(token), { headers }).then(async r => { if(!r.ok) throw new Error(await r.text()); return r.json(); }); }
  function postJson(path, body){ return fetch(path + (path.includes('?')?'&':'?') + 'token=' + encodeURIComponent(token), { method:'POST', headers:{ ...headers, 'Content-Type':'application/json' }, body:JSON.stringify(body) }).then(async r => { if(!r.ok) throw new Error(await r.text()); return r.json(); }); }
  function setStatus(text){ els.status.textContent = text; }
  function toast(text){ els.toast.textContent = text; els.toast.hidden = false; clearTimeout(els.toast._t); els.toast._t = setTimeout(() => els.toast.hidden = true, 2200); }
  function escapeHtml(value){ return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }

  async function init(){
    try {
      setDesktopView('map');
      setMobilePanel(document.body.dataset.mobilePanel || 'map');
      setupMapInteraction();
      els.drawCanvas = document.createElement('canvas'); els.drawCanvas.className='draw-layer'; els.map.appendChild(els.drawCanvas);
      bindControls();
      const savedHidden = (localStorage.getItem('vendorMapHiddenItems') || '').toLowerCase();
      els.hiddenItems.value = savedHidden;
      state.hiddenItems = new Set(savedHidden.split(',').map(v => v.trim()).filter(Boolean));
      els.lineColor.value = state.lineColor;
      const guilds = await api('/api/guilds');
      els.guild.innerHTML = '';
      (guilds.guilds || []).forEach(g => { const o = document.createElement('option'); o.value = g.id; o.textContent = g.name + (g.connected ? ' • connected' : ' • offline'); els.guild.appendChild(o); });
      const requested = qs.get('guildId');
      if (requested && [...els.guild.options].some(o => o.value === requested)) els.guild.value = requested;
      if (els.guild.value) await load(); else setStatus('No guilds available');
    }
    catch (err) { setStatus('Failed: ' + err.message); }
  }

  function bindControls(){
    ['input','change'].forEach(evt => {
      [els.search, els.showVending, els.showTraveling, els.showOutOfStock, els.hideEmptyVending, els.showPlayers, els.showMonuments].forEach(el => el.addEventListener(evt, render));
    });
    els.guild.addEventListener('change', load);
    document.getElementById('refreshNow').addEventListener('click', load);
    document.getElementById('fitMap').addEventListener('click', fitMap);
    document.getElementById('closeDetails').addEventListener('click', () => { state.selectedId = null; els.details.classList.add('closed'); render(); });
    document.getElementById('copyLink').addEventListener('click', async () => { await navigator.clipboard.writeText(location.origin + '/?token=' + encodeURIComponent(token) + '&guildId=' + encodeURIComponent(els.guild.value)); toast('Link copied'); });
    document.getElementById('exportJson').addEventListener('click', () => { window.open('/api/export?token=' + encodeURIComponent(token) + '&guildId=' + encodeURIComponent(els.guild.value), '_blank'); });
    document.getElementById('saveHome').addEventListener('click', saveHome);
    document.getElementById('clearHome').addEventListener('click', clearHome);
    document.getElementById('homeFromSelected').addEventListener('click', setHomeFromSelected);
    document.getElementById('saveRefresh').addEventListener('click', saveRefreshInterval);
    document.getElementById('addMarkerAtCenter').addEventListener('click', addMarkerAtCenter);
    document.getElementById('toggleDraw').addEventListener('click', toggleDrawMode);
    document.getElementById('toggleDrawOverlay').addEventListener('click', toggleDrawMode);
    document.getElementById('toggleEraserOverlay').addEventListener('click', toggleEraserMode);
    document.getElementById('clearDrawings').addEventListener('click', clearDrawings);
    els.lineColor.addEventListener('input', () => { state.lineColor = els.lineColor.value || '#fbbf24'; renderAnnotations(); });
    els.hiddenItems.addEventListener('change', () => {
      const raw = (els.hiddenItems.value || '').toLowerCase();
      localStorage.setItem('vendorMapHiddenItems', raw);
      state.hiddenItems = new Set(raw.split(',').map(v => v.trim()).filter(Boolean));
      render();
    });
    els.toggleVendorList.addEventListener('click', () => {
      state.vendorListVisible = !state.vendorListVisible;
      els.vendorList.style.display = state.vendorListVisible ? 'grid' : 'none';
      els.toggleVendorList.textContent = state.vendorListVisible ? 'Hide vendor list' : 'Show vendor list';
    });
    document.querySelectorAll('.mobile-tab[data-panel]').forEach(tab => tab.addEventListener('click', () => setMobilePanel(tab.dataset.panel)));
    document.querySelectorAll('.desktop-tab[data-view]').forEach(tab => tab.addEventListener('click', () => setDesktopView(tab.dataset.view)));
    const pointFromEvent = (e) => { const r = els.map.getBoundingClientRect(); return { x:(e.clientX - r.left - state.x)/state.scale, y:(e.clientY - r.top - state.y)/state.scale }; };
    els.map.addEventListener('pointerdown', (e)=>{ if(!state.drawMode) return; e.preventDefault(); e.stopPropagation(); state.drawing=true; const pt=pointFromEvent(e); state.currentStroke=[pt]; });
    els.map.addEventListener('pointermove', (e)=>{ if(!state.drawMode||!state.drawing) return; e.preventDefault(); e.stopPropagation(); state.currentStroke.push(pointFromEvent(e)); renderAnnotations(); });
    els.map.addEventListener('pointerup', async (e)=>{ if(!state.drawMode||!state.drawing) return; e.preventDefault(); e.stopPropagation(); state.drawing=false; if(state.currentStroke&&state.currentStroke.length>1){ state.annotations.strokes.push({ mode: state.eraserMode ? 'erase' : 'draw', color: state.lineColor, points: state.currentStroke }); state.annotationsDirty = true; } state.currentStroke=null; renderAnnotations(); });
    els.map.addEventListener('pointercancel', ()=>{ state.drawing=false; state.currentStroke=null; });
  }

  function setMobilePanel(panel){
    document.body.dataset.mobilePanel = panel || 'map';
    document.querySelectorAll('.mobile-tab[data-panel]').forEach(tab => tab.classList.toggle('active', tab.dataset.panel === document.body.dataset.mobilePanel));
    if (document.body.dataset.mobilePanel === 'map') setTimeout(fitMap, 0);
  }

  function setDesktopView(view){
    const current = view === 'team' ? 'team' : 'map';
    document.body.dataset.desktopView = current;
    const layout = document.querySelector('.layout');
    const teamPage = document.querySelector('.team-page');
    if (layout) layout.style.display = current === 'team' ? 'none' : 'grid';
    if (teamPage) teamPage.style.display = current === 'team' ? 'block' : 'none';
    document.querySelectorAll('.desktop-tab[data-view]').forEach(tab => tab.classList.toggle('active', tab.dataset.view === current));
    if (current === 'map') setTimeout(fitMap, 0);
    else refreshTeamData(true).then(() => renderTeamManagement());
  }

  async function load(){
    if (!els.guild.value) return;
    setStatus('Loading…');
    const data = await api('/api/vendor-map?guildId=' + encodeURIComponent(els.guild.value));
    state.data = data;
    state.annotations = data.config?.annotations || { markers: [], strokes: [] };
    state.annotationsDirty = false;
    els.showOutOfStock.checked = false;
    els.refreshSeconds.value = Math.max(2, data.config?.autoRefreshSeconds || 5);
    syncHomeInputs(data.config?.home || null);
    await refreshTeamData(true);
    renderMapImage(data.map || {});
    render();
    setStatus('Updated ' + new Date(data.generatedAt).toLocaleTimeString());
    clearInterval(state.timer);
    const seconds = Math.max(2, data.config?.autoRefreshSeconds || 5);
    state.timer = setInterval(refreshQuietly, seconds * 1000);
  }

  async function refreshQuietly(){
    if (state.drawMode || state.drawing) return;
    try {
      const data = await api('/api/vendor-map?guildId=' + encodeURIComponent(els.guild.value));
      const oldImage = state.data?.map?.image;
      state.data = data;
      const canSyncAnnotations = !state.drawMode && !state.drawing && !state.currentStroke && !state.annotationsDirty;
      if (canSyncAnnotations) {
        state.annotations = data.config?.annotations || { markers: [], strokes: [] };
        state.annotationsDirty = false;
      }
      if (document.activeElement !== els.refreshSeconds) els.refreshSeconds.value = Math.max(2, data.config?.autoRefreshSeconds || 5);
      syncHomeInputs(data.config?.home || null, false);
      if (data.map?.image && data.map.image !== oldImage) renderMapImage(data.map);
      if (document.body.dataset.desktopView === 'team' || document.body.dataset.mobilePanel === 'team') await refreshTeamData(false);
      render();
      setStatus('Updated ' + new Date(data.generatedAt).toLocaleTimeString());
    }
    catch (_) { /* keep stale data visible */ }
  }

  async function refreshTeamData(force){
    if (!els.guild.value) return;
    const stale = (Date.now() - state.teamUpdatedAt) > 60000;
    if (!force && !stale && state.teamData) return;
    try {
      const team = await api('/api/team?guildId=' + encodeURIComponent(els.guild.value));
      state.teamData = team;
      state.teamUpdatedAt = Date.now();
    } catch (_) { /* keep old cached team data */ }
  }

  function renderMapImage(map){
    state.mapSize = map.mapSize || null; state.ocean = map.oceanMargin || 0;
    if (!map.image) { els.img.removeAttribute('src'); els.empty.style.display = 'block'; return; }
    els.empty.style.display = 'none';
    els.img.onload = () => { state.imgW = els.img.naturalWidth; state.imgH = els.img.naturalHeight; fitMap(); render(); };
    els.img.src = map.image;
  }

  function render(){
    const data = state.data || {}; const summary = data.summary || {};
    els.stats.innerHTML = stat(summary.vendingMachineCount, 'vending machines') + stat(summary.travelingVendorCount, 'traveling vendors') + stat(summary.inStockOrderCount, 'in-stock orders') + stat(summary.uniqueItems, 'unique items');
    const filtered = getFilteredVendors();
    renderCheapest();
    renderPriceChecks();
    renderProfitTrades();
    renderVendorList(filtered);
    if (document.body.dataset.desktopView === 'team' || document.body.dataset.mobilePanel === 'team') renderTeamManagement();
    renderMarkers(filtered);
    renderAnnotations();
    renderEvents(data.events || []);
    if (state.selectedId) {
      const selectedCluster = findClusterById(state.selectedId, filtered);
      const selected = [...(data.vendors?.vendingMachines || []), ...(data.vendors?.travelingVendors || [])].find(v => v.id === state.selectedId);
      if (selectedCluster) renderClusterDetails(selectedCluster);
      else if (selected) renderDetails(selected);
      else els.details.classList.add('closed');
    }
  }

  function stat(value, label){ return '<div class="stat"><b>' + escapeHtml(value ?? 0) + '</b><span>' + escapeHtml(label) + '</span></div>'; }

  function isHiddenOrder(order){
    if (!order) return false;
    if (!state.hiddenItems.size) return false;
    const hay = [order.itemName, order.itemShortName, order.currencyName, order.currencyShortName].join(' ').toLowerCase();
    for (const token of state.hiddenItems) { if (token && hay.includes(token)) return true; }
    return false;
  }

  function getFilteredVendors(){
    const data = state.data || {}; const q = els.search.value.trim().toLowerCase(); const out = [];
    if (els.showVending.checked) out.push(...(data.vendors?.vendingMachines || []));
    if (els.showTraveling.checked) out.push(...(data.vendors?.travelingVendors || []));
    return out.filter(v => {
      if (els.hideEmptyVending.checked && v.type === 'vending') {
        const visibleOrderCount = els.showOutOfStock.checked ? (v.inStockCount || 0) : (v.orderCount || 0);
        if (visibleOrderCount <= 0) return false;
      }
      if (!q) return true;
      const vendorText = [v.label, v.location, v.grid, v.type].join(' ').toLowerCase();
      return vendorText.includes(q) || (v.orders || []).some(o => !isHiddenOrder(o) && o.searchText.includes(q));
    });
  }


  function syncHomeInputs(home, overwrite=true){
    if (home && overwrite) { els.homeX.value = Math.round(home.x); els.homeY.value = Math.round(home.y); els.homeRadius.value = Math.round(home.radius || 100); }
    els.homeStatus.textContent = home ? ('Home: X ' + Math.round(home.x) + ', Y ' + Math.round(home.y) + ', radius ' + Math.round(home.radius || 100)) : 'No home set. Save coordinates or select a vendor and use it as home.';
  }


  async function saveRefreshInterval(){
    try {
      const seconds = Number(els.refreshSeconds.value || 5);
      const response = await postJson('/api/refresh-interval?guildId=' + encodeURIComponent(els.guild.value), { seconds });
      const saved = Math.max(2, response.autoRefreshSeconds || seconds);
      els.refreshSeconds.value = saved;
      clearInterval(state.timer);
      state.timer = setInterval(refreshQuietly, saved * 1000);
      toast('Refresh interval saved');
      setStatus('Refresh interval: ' + saved + 's');
    } catch(e) { toast('Refresh save failed'); setStatus('Error: ' + e.message); }
  }

  async function saveHome(){
    try {
      const gid = els.guild.value;
      const body = { x:Number(els.homeX.value), y:Number(els.homeY.value), radius:Number(els.homeRadius.value || 100) };
      await postJson('/api/home?guildId=' + encodeURIComponent(gid), body);
      toast('Home saved');
      await load();
    } catch(e) { toast('Home save failed'); setStatus('Error: ' + e.message); }
  }

  async function clearHome(){
    try { await postJson('/api/home?guildId=' + encodeURIComponent(els.guild.value), { clear:true }); toast('Home cleared'); await load(); }
    catch(e) { toast('Home clear failed'); setStatus('Error: ' + e.message); }
  }

  function setHomeFromSelected(){
    const selectedCluster = findClusterById(state.selectedId, getFilteredVendors());
    const vendor = selectedCluster || [...(state.data?.vendors?.vendingMachines || []), ...(state.data?.vendors?.travelingVendors || [])].find(v => v.id === state.selectedId);
    if (!vendor) { toast('Select a vendor marker/list row first'); return; }
    els.homeX.value = Math.round(vendor.x); els.homeY.value = Math.round(vendor.y); if (!els.homeRadius.value) els.homeRadius.value = 100;
    toast('Home coordinates copied from selected ' + (selectedCluster ? 'shop bundle' : 'vendor'));
  }

  function renderPriceChecks(){
    const q = els.search.value.trim().toLowerCase();
    const checks = (state.data?.priceChecks || []).filter(check => !isHiddenOrder(check) && (!q || (check.searchText || '').includes(q)));
    if (!state.data?.config?.home) { els.priceCheckList.innerHTML = '<div class="muted">Set your home location to compare your nearby vendors against the rest of the map.</div>'; return; }
    if (!checks.length) { els.priceCheckList.innerHTML = '<div class="muted">No cheaper competing vendors found for home-area prices.</div>'; return; }

    const grouped = new Map();
    checks.forEach(check => {
      const key = [check.itemId, check.currencyId, check.homeQuantity, check.homeCost, !!check.itemBlueprint, !!check.currencyBlueprint].join(':');
      const current = grouped.get(key);
      if (!current) grouped.set(key, { ...check, competitorVendorIds:[check.competitorVendorId], competitorLocations:[check.competitorGrid || check.competitorLocation || '?'] });
      else {
        current.competitorVendorIds.push(check.competitorVendorId);
        current.competitorLocations.push(check.competitorGrid || check.competitorLocation || '?');
        if (check.cheaperPercent > current.cheaperPercent || (check.cheaperPercent === current.cheaperPercent && check.cheaperBy > current.cheaperBy)) {
          const keepIds = current.competitorVendorIds;
          const keepLocs = current.competitorLocations;
          Object.assign(current, check);
          current.competitorVendorIds = keepIds;
          current.competitorLocations = keepLocs;
        }
      }
    });

    const rows = [...grouped.values()].sort((a, b) => b.cheaperPercent - a.cheaperPercent || b.cheaperBy - a.cheaperBy).slice(0, 16);
    els.priceCheckList.innerHTML = rows.map(check => {
      const uniqueLocations = [...new Set(check.competitorLocations)];
      const extra = uniqueLocations.length > 1 ? (' · ' + (uniqueLocations.length - 1) + ' more competing shops') : '';
      return '<div class="price-check-row" data-home-id="' + escapeHtml(check.homeVendorId) + '" data-comp-id="' + escapeHtml(check.competitorVendorId) + '">' + squareIcon(check) + '<div class="price-check-main"><div class="price-check-title">' + escapeHtml(check.itemName) + ' is cheaper elsewhere by up to ' + escapeHtml(check.cheaperPercent.toFixed(1)) + '%</div><div class="price-check-route">Our price: ' + escapeHtml(check.homeQuantity + '× for ' + check.homeCost + ' ' + check.currencyName) + ' · Best found: ' + escapeHtml(check.competitorQuantity + '× for ' + check.competitorCost + ' ' + check.currencyName) + '</div><div class="price-check-location">Best location: ' + escapeHtml(uniqueLocations[0] || '?') + escapeHtml(extra) + '</div></div></div>';
    }).join('');
    els.priceCheckList.querySelectorAll('.price-check-row').forEach(row => row.addEventListener('click', () => selectVendor(row.dataset.compId)));
  }


  function renderCheapest(){
    const byCategory = state.data?.cheapestByCategory || {}; const q = els.search.value.trim().toLowerCase();
    const blocks = [];
    Object.entries(byCategory).forEach(([category, offers]) => {
      const visible = (offers || []).filter(o => !isHiddenOrder(o) && (!q || (o.searchText || '').includes(q)));
      if (!visible.length) return;
      blocks.push('<div class="category-block"><div class="category-head"><span>' + escapeHtml(category) + '</span><span class="muted">' + visible.length + '</span></div>' + visible.slice(0, 12).map(cheapOfferHtml).join('') + (visible.length > 12 ? '<div class="cheap-row muted"><div></div><div>+' + (visible.length - 12) + ' more, narrow search to reveal</div></div>' : '') + '</div>');
    });
    els.cheapestList.innerHTML = blocks.length ? blocks.join('') : '<div class="muted">No in-stock vendor prices found.</div>';
    els.cheapestList.querySelectorAll('.cheap-row[data-offer-key]').forEach(row => row.addEventListener('click', (e) => {
      if (e.target.closest('.cheap-option')) return;
      state.expandedCheapest[row.dataset.offerKey] = !state.expandedCheapest[row.dataset.offerKey];
      renderCheapest();
    }));
    els.cheapestList.querySelectorAll('.cheap-option[data-vendor-id]').forEach(row => row.addEventListener('click', (e) => { e.stopPropagation(); selectVendor(row.dataset.vendorId); }));
  }

  function cheapOfferHtml(o){
    const title = (o.quantity || 0) + '× ' + o.itemName + (o.itemBlueprint ? ' BP' : '');
    const first = (o.cost || 0) + '× ' + o.currencyName + (o.currencyBlueprint ? ' BP' : '') + ' at ' + (o.grid || o.location || 'unknown');
    const count = o.priceOptionCount || (o.priceOptions || []).length || 1;
    const expanded = !!state.expandedCheapest[o.key];
    const options = expanded ? '<div class="cheap-options">' + (o.priceOptions || []).map(priceOptionHtml).join('') + '</div>' : '';
    return '<div class="cheap-row" data-offer-key="' + escapeHtml(o.key) + '">' + squareIcon(o) + '<div class="cheap-main"><div class="cheap-title">' + escapeHtml(title) + '</div><div class="cheap-cost">' + escapeHtml(count + ' payment option' + (count === 1 ? '' : 's') + ' · cheapest shown: ' + first) + '</div></div>' + options + '</div>';
  }

  function priceOptionHtml(o){
    const title = escapeHtml((o.cost || 0) + '× ' + o.currencyName + (o.currencyBlueprint ? ' BP' : ''));
    const meta = escapeHtml((o.quantity || 0) + '× item · ' + (o.grid || o.location || 'unknown'));
    return '<div class="cheap-option" data-vendor-id="' + escapeHtml(o.vendorId) + '"><div class="cheap-option-title">' + title + '</div><div class="cheap-option-meta">' + meta + '</div></div>';
  }

  function squareIcon(o, showStock){
    const stockClass = o && o.inStock === false ? ' stock-out' : ' stock-in';
    const badge = showStock ? '<span class="stock-badge" title="Stock">' + escapeHtml(o && Number.isFinite(Number(o.stock)) ? Number(o.stock) : 0) + '</span>' : '';
    if (o.itemIcon) return '<span class="shop-icon' + stockClass + '"><img src="' + escapeHtml(o.itemIcon) + '" alt="" />' + badge + '</span>';
    return '<span class="shop-icon' + stockClass + '">' + categoryIcon(o.itemCategory) + badge + '</span>';
  }

  function miniIcon(src){
    return src ? '<span class="mini-icon"><img src="' + escapeHtml(src) + '" alt="" /></span>' : '<span class="mini-icon placeholder">•</span>';
  }


  function popoverOrderHtml(o){
    return '<div class="cluster-item"><div class="trade-cell">' + miniIcon(o.itemIcon) + '<span>' + escapeHtml((o.quantity || 0) + '× ' + o.itemName + (o.itemBlueprint ? ' BP' : '')) + '</span></div><span class="trade-arrow">for</span><div class="trade-cell">' + miniIcon(o.currencyIcon) + '<span>' + escapeHtml((o.cost || 0) + '× ' + o.currencyName + (o.currencyBlueprint ? ' BP' : '')) + '</span></div></div>';
  }

  function categoryIcon(category){
    return ({ 'Guns & Weapons':'🔫', 'Ammo & Explosives':'💥', 'Clothing & Armor':'🧥', 'Components':'⚙️', 'Building & Deployables':'🧱', 'Resources':'⛏️', 'Tools':'🛠️', 'Medical':'➕', 'Food & Farming':'🌽', 'Electrical':'🔌', 'Vehicles':'🚗', 'Other':'📦' })[category] || '📦';
  }


  function renderProfitTrades(){
    const q = els.search.value.trim().toLowerCase();
    const routes = (state.data?.profitTrades || []).filter(route => !isHiddenOrder(route) && (!q || (route.searchText || '').includes(q)));
    if (!routes.length) { els.profitList.innerHTML = '<div class="muted">No profitable buy/sell routes found.</div>'; return; }
    els.profitList.innerHTML = routes.slice(0, 12).map(route => '<div class="profit-row" data-buy-id="' + escapeHtml(route.buyVendorId) + '" data-sell-id="' + escapeHtml(route.sellVendorId) + '"><span class="shop-icon">↔️</span><div class="profit-main"><div class="profit-title">' + escapeHtml(route.itemName) + ' → +' + escapeHtml(route.totalProfit) + ' ' + escapeHtml(route.currencyName) + '</div><div class="profit-route">' + escapeHtml(route.routeText) + '</div><div class="profit-gain">Route: ' + escapeHtml(route.buyGrid || '?') + ' → ' + escapeHtml(route.sellGrid || '?') + ' · max ' + escapeHtml(route.tradableItemCount) + ' items</div></div></div>').join('');
    els.profitList.querySelectorAll('.profit-row').forEach(row => row.addEventListener('click', () => selectVendor(row.dataset.buyId)));
  }

  function renderVendorList(vendors){
    if (!vendors.length) { els.vendorList.innerHTML = '<div class="muted">No vendors match the current filters.</div>'; return; }
    els.vendorList.innerHTML = vendors.map(v => {
      const stock = v.type === 'traveling' ? (v.halted ? 'halted' : 'moving') : (v.inStockCount + '/' + v.orderCount + ' in stock');
      return '<div class="vendor-row ' + (v.id === state.selectedId ? 'active' : '') + '" data-id="' + escapeHtml(v.id) + '"><div class="vendor-title"><span>' + icon(v) + ' ' + escapeHtml(v.label) + '</span><span>' + escapeHtml(v.grid || '') + '</span></div><div class="vendor-meta">' + escapeHtml(v.location || 'Unknown location') + '</div><span class="pill ' + (v.type === 'traveling' ? 'warn' : ((v.inStockCount || 0) > 0 ? 'good' : 'danger')) + '">' + escapeHtml(stock) + '</span></div>';
    }).join('');
    els.vendorList.querySelectorAll('.vendor-row').forEach(row => row.addEventListener('click', () => selectVendor(row.dataset.id)));
  }

  async function renderTeamManagement(){
    if (!els.teamList || !els.guild.value) return;
    try {
      await refreshTeamData(false);
      const team = state.teamData || { ok:false };
      if (!team.ok) { els.teamList.innerHTML = '<div class="muted">Team info unavailable.</div>'; return; }
      els.teamList.innerHTML = (team.members || []).map(m => {
        const avatar = m.avatarUrl ? '<img src="' + escapeHtml(m.avatarUrl) + '" />' : '👤';
        const bmText = m.battlemetrics?.playtimeHours != null
          ? ('Battlemetric Hours: ' + m.battlemetrics.playtimeHours + 'h')
          : (m.battlemetrics?.playerId ? ('Battlemetric Hours: profile ' + m.battlemetrics.playerId + ' (no playtime)') : 'Battlemetric Hours: unavailable');
        const promoteBtn = team.hosterIsTeamLeader && !m.isLeader ? '<button class="btn full js-promote" data-steamid="' + escapeHtml(m.steamId) + '">Promote</button>' : '';
        const kickBtn = team.hosterIsTeamLeader && !m.isLeader ? '<button class="btn full js-kick" data-steamid="' + escapeHtml(m.steamId) + '">Kick</button>' : '';
        return '<div class="vendor-row"><div class="vendor-title"><span class="shop-icon">' + avatar + '</span><span>' + escapeHtml(m.name) + (m.isLeader ? ' 👑' : '') + '</span></div><div class="vendor-meta">' + escapeHtml(m.steamId || '-') + (m.isOnline ? ' • online' : ' • offline') + '</div><div class="vendor-meta">' + escapeHtml(bmText) + '</div><div class="map-buttons" style="margin-top:8px">' + promoteBtn + kickBtn + '</div></div>';
      }).join('') || '<div class="muted">No team members available.</div>';
      els.teamList.querySelectorAll('.js-promote').forEach(b => b.addEventListener('click', async () => { await postJson('/api/team/promote?guildId=' + encodeURIComponent(els.guild.value), { steamId: b.dataset.steamid }); toast('Promote request sent'); renderTeamManagement(); }));
      els.teamList.querySelectorAll('.js-kick').forEach(b => b.addEventListener('click', async () => {
        try { await postJson('/api/team/kick?guildId=' + encodeURIComponent(els.guild.value), { steamId: b.dataset.steamid }); toast('Kick request sent'); renderTeamManagement(); }
        catch (e) { toast('Kick failed: ' + e.message); }
      }));
    } catch (e) {
      els.teamList.innerHTML = '<div class="muted">Failed to load team: ' + escapeHtml(e.message) + '</div>';
    }
  }


  function addMarkerAtCenter(){
    const mapX = (-state.x + (els.map.clientWidth/2)) / state.scale;
    const mapY = (-state.y + (els.map.clientHeight/2)) / state.scale;
    state.annotations.markers.push({ x: Math.round(mapX), y: Math.round(mapY), label: 'Custom' });
    state.annotationsDirty = true;
    saveAnnotations();
    render();
  }

  function syncDrawButtons(){
    document.getElementById('toggleDraw').textContent = state.drawMode ? 'Stop drawing' : 'Start drawing';
    document.getElementById('toggleDrawOverlay').classList.toggle('active', state.drawMode && !state.eraserMode);
    document.getElementById('toggleEraserOverlay').classList.toggle('active', state.drawMode && state.eraserMode);
    els.map.style.cursor = state.drawMode ? 'crosshair' : 'grab';
    if (els.drawCanvas) els.drawCanvas.style.pointerEvents = state.drawMode ? 'auto' : 'none';
  }

  async function toggleDrawMode(){ state.drawMode = !state.drawMode; if (!state.drawMode) { state.eraserMode = false; if (state.annotationsDirty) await saveAnnotations(); await refreshQuietly(); } syncDrawButtons(); }
  function toggleEraserMode(){ if (!state.drawMode) state.drawMode = true; state.eraserMode = !state.eraserMode; syncDrawButtons(); }

  async function clearDrawings(){
    state.annotations = { markers: [], strokes: [] };
    state.annotationsDirty = true;
    await saveAnnotations();
    render();
  }

  async function saveAnnotations(){
    try { await postJson('/api/annotations?guildId=' + encodeURIComponent(els.guild.value), state.annotations); state.annotationsDirty = false; } catch(_){ state.annotationsDirty = true; }
  }

  function renderAnnotations(){
    if (!els.drawCanvas) return;
    const cvs = els.drawCanvas;
    cvs.width = Math.max(1, state.imgW || els.map.clientWidth); cvs.height = Math.max(1, state.imgH || els.map.clientHeight);
    cvs.style.width = cvs.width + 'px'; cvs.style.height = cvs.height + 'px';
    const ctx = cvs.getContext('2d'); ctx.clearRect(0,0,cvs.width,cvs.height); ctx.lineCap='round';
    (state.annotations.strokes||[]).forEach(st=>{ const pts = Array.isArray(st) ? st : st?.points; if(!Array.isArray(pts)||pts.length<2)return; ctx.save(); if(st?.mode==='erase'){ ctx.globalCompositeOperation='destination-out'; ctx.lineWidth=20; ctx.strokeStyle='rgba(0,0,0,1)'; } else { ctx.globalCompositeOperation='source-over'; ctx.lineWidth=4; ctx.strokeStyle=st?.color || '#fbbf24'; } ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); pts.forEach(pt=>ctx.lineTo(pt.x, pt.y)); ctx.stroke(); ctx.restore(); });
    if (state.currentStroke && state.currentStroke.length > 1) { ctx.save(); if(state.eraserMode){ ctx.globalCompositeOperation='destination-out'; ctx.lineWidth=20; ctx.strokeStyle='rgba(0,0,0,1)'; } else { ctx.lineWidth=4; ctx.strokeStyle=state.lineColor || '#fbbf24'; } ctx.beginPath(); ctx.moveTo(state.currentStroke[0].x, state.currentStroke[0].y); state.currentStroke.forEach(pt=>ctx.lineTo(pt.x, pt.y)); ctx.stroke(); ctx.restore(); }
    (state.annotations.markers||[]).forEach(m=>{ ctx.fillStyle='#60a5fa'; ctx.beginPath(); ctx.arc(m.x,m.y,8,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#fff'; ctx.fillText(m.label||'M', m.x+10, m.y-10); });
  }

  function renderMarkers(vendors){
    const openPopover = els.layer.querySelector('.marker.selected .vendor-popover,.marker.selected .cluster-popover');
    state.popoverScrollTop = openPopover ? openPopover.scrollTop : state.popoverScrollTop;
    els.layer.innerHTML = '';
    const map = state.data?.map || {};
    if (els.showMonuments.checked) (map.monuments || []).forEach(m => addMarker({ id:'monument-' + m.token + '-' + m.x + '-' + m.y, type:'monument', label:m.name, x:m.x, y:m.y }, null));
    if (els.showPlayers.checked) (map.players || []).forEach(p => addMarker({ id:'player-' + (p.steamId || p.name), type:'player', label:p.name, avatarUrl:p.avatarUrl, x:p.x, y:p.y }, null));
    if (state.data?.config?.home) addMarker({ id:'home', type:'home', label:'Home', x:state.data.config.home.x, y:state.data.config.home.y }, null);
    const clusters = buildVendorClusters(vendors.filter(v => v.type === 'vending'));
    clusters.forEach(cluster => cluster.vendors.length > 1 ? addClusterMarker(cluster) : addMarker(cluster.vendors[0], () => selectVendor(cluster.vendors[0].id)));
    vendors.filter(v => v.type !== 'vending').forEach(v => addMarker(v, () => selectVendor(v.id)));
    const restoredPopover = els.layer.querySelector('.marker.selected .vendor-popover,.marker.selected .cluster-popover');
    if (restoredPopover && state.popoverScrollTop) restoredPopover.scrollTop = state.popoverScrollTop;
    applyTransform();
  }

  function buildVendorClusters(vendors){
    const remaining = vendors.slice(); const clusters = [];
    while (remaining.length) {
      const seed = remaining.shift(); const group = [seed];
      for (let i = remaining.length - 1; i >= 0; i--) {
        const other = remaining[i];
        if (distance(seed, other) <= 55 || (seed.grid && seed.grid === other.grid && distance(seed, other) <= 95)) group.push(remaining.splice(i, 1)[0]);
      }
      const x = group.reduce((sum, v) => sum + (v.x || 0), 0) / group.length;
      const y = group.reduce((sum, v) => sum + (v.y || 0), 0) / group.length;
      clusters.push({ id:'cluster-' + group.map(v => v.id).join('-'), type:'cluster', x, y, vendors: group });
    }
    return clusters;
  }


  function findClusterById(id, vendors){
    if (!id || !String(id).startsWith('cluster-')) return null;
    return buildVendorClusters((vendors || []).filter(v => v.type === 'vending')).find(cluster => cluster.id === id) || null;
  }

  function markerStockClass(target){
    const vendors = target.vendors || [target];
    return vendors.some(v => (v.inStockCount || 0) > 0) ? 'stock-in' : 'stock-out';
  }

  function selectCluster(cluster){
    if (state.selectedId !== cluster.id) state.popoverScrollTop = 0;
    state.selectedId = cluster.id;
    centerOn(cluster.x, cluster.y);
    renderClusterDetails(cluster);
    render();
  }


  function getVisibleOrders(vendor){
    const orders = vendor.orders || [];
    return els.showOutOfStock.checked ? orders.filter(o => o.inStock) : orders;
  }

  function renderClusterDetails(cluster){
    els.details.classList.remove('closed');
    const vendorBlocks = cluster.vendors.map(v => {
      const orders = getVisibleOrders(v);
      return '<section class="cluster-detail-vendor"><h3>' + escapeHtml(v.label || 'Vending machine') + ' · ' + escapeHtml(v.grid || v.location || '?') + '</h3>' + (orders.length ? orders.map(orderHtml).join('') : '<div class="muted">No visible sell listings.</div>') + '</section>';
    }).join('');
    els.detailsBody.innerHTML = '<h2>🛒 ' + cluster.vendors.length + ' vending machines</h2><div class="muted">Bundled shops at this location</div><p><span class="pill">X ' + Math.round(cluster.x) + '</span><span class="pill">Y ' + Math.round(cluster.y) + '</span></p>' + vendorBlocks;
  }

  function distance(a,b){ const dx = (a.x || 0) - (b.x || 0); const dy = (a.y || 0) - (b.y || 0); return Math.sqrt(dx * dx + dy * dy); }

  function addClusterMarker(cluster){
    const pos = worldToPixels(cluster.x, cluster.y); const el = document.createElement('button');
    el.className = 'marker cluster ' + markerStockClass(cluster) + (cluster.id === state.selectedId ? ' selected' : ''); el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px'; el.title = cluster.vendors.length + ' vending machines';
    el.innerHTML = markerImageHtml(STACKED_VENDING_MACHINE_MARKER_IMAGE, cluster.vendors.length + ' vending machines') + '<span class="cluster-count">' + cluster.vendors.length + '</span>' + clusterPopoverHtml(cluster);
    el.addEventListener('click', e => { e.stopPropagation(); selectCluster(cluster); });
    els.layer.appendChild(el);
    wirePopoverInteractions(el);
  }

  function clusterPopoverHtml(cluster){
    return '<div class="cluster-popover">' + cluster.vendors.map(v => { const orders = getVisibleOrders(v); return '<div class="cluster-vendor"><div class="cluster-items">' + (orders.length ? orders.map(popoverOrderHtml).join('') : '<div class="muted">No visible sell listings.</div>') + '</div></div>'; }).join('') + '</div>';
  }


  function vendorPopoverHtml(vendor){
    const visibleOrders = getVisibleOrders(vendor);
    return '<div class="vendor-popover"><div class="cluster-items">' + (visibleOrders.length ? visibleOrders.map(popoverOrderHtml).join('') : '<div class="muted">No visible sell listings.</div>') + '</div></div>';
  }

  function addMarker(vendor, onclick){
    const pos = worldToPixels(vendor.x, vendor.y); const el = document.createElement('button');
    el.className = 'marker ' + vendor.type + (vendor.type === 'vending' ? ' ' + markerStockClass(vendor) : '') + (vendor.avatarUrl ? ' avatar' : '') + (vendor.id === state.selectedId ? ' selected' : '');
    el.style.left=pos.x+'px'; el.style.top=pos.y+'px'; el.title=(vendor.label||'')+' '+(vendor.location||'');
    const markerFace = vendor.type === 'vending' ? markerImageHtml(VENDING_MACHINE_MARKER_IMAGE, 'Vending machine') : (vendor.type === 'player' && vendor.avatarUrl ? markerImageHtml(vendor.avatarUrl, vendor.label || 'Player', ' avatar-image') : icon(vendor));
    el.innerHTML = markerFace + '<span class="marker-label">' + escapeHtml(shortLabel(vendor)) + '</span>' + (vendor.type === 'vending' ? vendorPopoverHtml(vendor) : '');
    if (onclick) el.addEventListener('click', e => { e.stopPropagation(); onclick(); });
    els.layer.appendChild(el);
    wirePopoverInteractions(el);
  }

  function markerImageHtml(src, alt, extraClass){
    return '<img class="marker-image' + escapeHtml(extraClass || '') + '" src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt || 'Marker') + '" draggable="false" />';
  }

  function wirePopoverInteractions(markerEl){
    markerEl.querySelectorAll('.cluster-popover,.vendor-popover').forEach(popover => {
      popover.addEventListener('wheel', e => e.stopPropagation(), { passive:true });
      ['mousedown','click','dblclick'].forEach(evt => popover.addEventListener(evt, e => e.stopPropagation()));
    });
  }

  function selectVendor(id){ if (state.selectedId !== id) state.popoverScrollTop = 0; state.selectedId = id; const all = [...(state.data?.vendors?.vendingMachines || []), ...(state.data?.vendors?.travelingVendors || [])]; const vendor = all.find(v => v.id === id); if (vendor) { centerOn(vendor.x, vendor.y); renderDetails(vendor); } render(); }
  function renderDetails(v){
    els.details.classList.remove('closed');
    const orders = getVisibleOrders(v);
    els.detailsBody.innerHTML = '<h2>' + icon(v) + ' ' + escapeHtml(v.label) + '</h2><div class="muted">' + escapeHtml(v.location || 'Unknown location') + '</div><p><span class="pill">Grid ' + escapeHtml(v.grid || '?') + '</span><span class="pill">X ' + Math.round(v.x) + '</span><span class="pill">Y ' + Math.round(v.y) + '</span></p>' + (v.type === 'traveling' ? '<p class="pill warn">' + (v.halted ? 'Halted' : 'Moving') + '</p>' : '<h2>Sell orders</h2>' + (orders.length ? orders.map(orderHtml).join('') : '<div class="muted">No visible sell listings.</div>'));
  }
  function orderHtml(o){ const left = escapeHtml((o.quantity || 0) + '× ' + o.itemName + (o.itemBlueprint ? ' BP' : '')); const right = escapeHtml((o.cost || 0) + '× ' + o.currencyName + (o.currencyBlueprint ? ' BP' : '')); return '<div class="order ' + (o.inStock ? '' : 'out') + '"><div class="item"><b>' + squareIcon(o, true) + '<span>' + left + '</span></b></div><div class="arrow">for</div><div class="item"><b>' + squareIcon({ itemIcon:o.currencyIcon, itemCategory:o.itemCategory, inStock:o.inStock }) + '<span>' + right + '</span></b></div></div>'; }
  function renderEvents(events){ els.events.innerHTML = events.length ? events.slice(0,8).map(e => '<div class="event"><b>' + escapeHtml(new Date(e.time).toLocaleTimeString()) + '</b><br>' + escapeHtml(e.text) + '</div>').join('') : 'No events yet.'; }

  function icon(v){ return v.type === 'home' ? '⌂' : v.type === 'traveling' ? '🚚' : v.type === 'player' ? '👤' : v.type === 'monument' ? '◆' : '🛒'; }
  function shortLabel(v){ if (v.type === 'home') return 'Home'; if (v.type === 'vending') return v.grid || 'Vendor'; if (v.type === 'traveling') return v.halted ? 'Halted' : 'Vendor'; return v.label || ''; }
  function worldToPixels(x,y){ if(!state.mapSize || !state.imgW || !state.imgH) return {x:0,y:0}; const effW = state.imgW - 2 * state.ocean; const effH = state.imgH - 2 * state.ocean; return { x: (x * (effW / state.mapSize)) + state.ocean, y: state.imgH - ((y * (effH / state.mapSize)) + state.ocean) }; }
  function applyTransform(){ const t = 'translate(' + state.x + 'px,' + state.y + 'px) scale(' + state.scale + ')'; els.img.style.transform = t; els.layer.style.transform = t; if (els.drawCanvas) els.drawCanvas.style.transform = t; els.layer.style.setProperty('--inverse-scale', String(1 / Math.max(state.scale || 1, 0.001))); }
  function fitMap(){ const rect = els.map.getBoundingClientRect(); if(!state.imgW || !state.imgH || !rect.width || !rect.height) return; state.scale = Math.min(rect.width / state.imgW, rect.height / state.imgH) || 1; state.x = (rect.width - state.imgW * state.scale) / 2; state.y = (rect.height - state.imgH * state.scale) / 2; applyTransform(); }
  function centerOn(x,y){ const pos = worldToPixels(x,y); const rect = els.map.getBoundingClientRect(); if(!pos) return; state.x = rect.width / 2 - pos.x * state.scale; state.y = rect.height / 2 - pos.y * state.scale; applyTransform(); }
  function zoomAt(clientX, clientY, factor){ const rect = els.map.getBoundingClientRect(); const mx = clientX - rect.left, my = clientY - rect.top; const before = { x:(mx - state.x) / state.scale, y:(my - state.y) / state.scale }; state.scale = Math.max(0.12, Math.min(8, state.scale * factor)); state.x = mx - before.x * state.scale; state.y = my - before.y * state.scale; applyTransform(); }
  function touchDistance(a,b){ const dx = a.clientX - b.clientX; const dy = a.clientY - b.clientY; return Math.sqrt(dx * dx + dy * dy); }
  function touchMidpoint(a,b){ return { clientX:(a.clientX + b.clientX) / 2, clientY:(a.clientY + b.clientY) / 2 }; }

  function setupMapInteraction(){
    let dragging = false, lx = 0, ly = 0, lastPinchDistance = 0;
    els.map.addEventListener('mousedown', e => { dragging = true; lx = e.clientX; ly = e.clientY; els.map.classList.add('dragging'); });
    window.addEventListener('mouseup', () => { dragging = false; els.map.classList.remove('dragging'); });
    window.addEventListener('mousemove', e => { if(!dragging) return; state.x += e.clientX - lx; state.y += e.clientY - ly; lx = e.clientX; ly = e.clientY; applyTransform(); });
    els.map.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 0.87); }, { passive:false });
    els.map.addEventListener('touchstart', e => { if (state.drawMode) return;
      if (e.touches.length === 1) { dragging = true; lx = e.touches[0].clientX; ly = e.touches[0].clientY; els.map.classList.add('dragging'); }
      else if (e.touches.length === 2) { dragging = false; lastPinchDistance = touchDistance(e.touches[0], e.touches[1]); }
    }, { passive:false });
    els.map.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 2) { const nextDistance = touchDistance(e.touches[0], e.touches[1]); if (lastPinchDistance > 0) { const midpoint = touchMidpoint(e.touches[0], e.touches[1]); zoomAt(midpoint.clientX, midpoint.clientY, nextDistance / lastPinchDistance); } lastPinchDistance = nextDistance; return; }
      if (state.drawMode) return;
      if (e.touches.length === 1 && dragging) { const touch = e.touches[0]; state.x += touch.clientX - lx; state.y += touch.clientY - ly; lx = touch.clientX; ly = touch.clientY; applyTransform(); }
    }, { passive:false });
    ['touchend','touchcancel'].forEach(evt => els.map.addEventListener(evt, e => { if (e.touches.length < 2) lastPinchDistance = 0; if (e.touches.length === 0) { dragging = false; els.map.classList.remove('dragging'); } }, { passive:false }));
    ['gesturestart','gesturechange','gestureend'].forEach(evt => els.map.addEventListener(evt, e => e.preventDefault(), { passive:false }));
    els.map.addEventListener('click', () => { state.selectedId = null; els.details.classList.add('closed'); render(); });
  }

  init();
})();`;
}

function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#ce412b"/><path d="M16 20h5l5 25h21l5-16H27" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="31" cy="50" r="4" fill="#fff"/><circle cx="47" cy="50" r="4" fill="#fff"/></svg>`;
}
