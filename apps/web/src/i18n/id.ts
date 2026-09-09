import type { Catalog } from './index.js';

/**
 * Bahasa Indonesia.
 *
 * Register: everyday spoken Indonesian, the way an organizer talks at the side
 * of the court, not written formal Indonesian. So "cuma" rather than "hanya",
 * "bikin" rather than "menyebabkan", "-mu" rather than "Anda". Racket-sport
 * vocabulary in Indonesia is borrowed from English and stays borrowed here:
 * poin, ronde, klasemen, skor, tim. "Lapangan" is court, "panitia" is the
 * organizer, and "HP" is the phone.
 *
 * Indonesian has no plural inflection, so several of these lose the English
 * awkwardness rather than importing it: "{count} pemain" is right for one
 * player and for nine.
 *
 * Typed as `Catalog`, so a key missing here or invented here is a compile
 * error rather than a dotted path that reaches a phone.
 */
export const id: Catalog = {
  app: {
    name: 'tanteo',
    tagline: 'Skor padel yang tahan pemain datang dan pergi',
    /** The meta description, and the manifest's, in one place. */
    description:
      'Pencatat skor padel Americano dan Mexicano yang tahan pemain datang dan pergi.',
  },

  common: {
    cancel: 'Batal',
    back: 'Kembali',
    done: 'Selesai',
    save: 'Simpan',
    remove: 'Hapus',
    confirm: 'Ya, lanjut',
    round: 'Ronde',
    court: 'Lapangan',
    points: 'poin',
    loading: 'Membuka turnamenmu',
    retry: 'Coba lagi',
  },

  nav: {
    label: 'Bagian',
  },

  stepper: {
    decrease: '{label}: kurangi satu',
    increase: '{label}: tambah satu',
  },

  home: {
    emptyTitle: 'Belum ada turnamen jalan',
    emptyBody: 'Siapkan dulu, semenit juga sudah bisa mulai catat skor.',
    newTournament: 'Siapkan turnamen',
    resumeTitle: 'Lanjut dari tadi',
    resumeAction: 'Lanjut',
    discard: 'Buang turnamen ini',
    discardConfirm: 'Buang {name}? Semua skornya ikut hilang.',
    roundProgress: 'Ronde {current} dari {total}',
    roundOpen: 'Ronde {current}',
    playerCount: '{count} pemain',
  },

  setup: {
    title: 'Siapkan turnamen',
    nameLabel: 'Nama',
    namePlaceholder: 'Jumat malam di klub',
    formatLabel: 'Format',
    americano: 'Americano',
    mexicano: 'Mexicano',
    americanoHint:
      'Undian tetap. Semua kebagian jadi pasangan semua, sejauh jumlah pemainnya cukup.',
    mexicanoHint: 'Tiap ronde diundi dari klasemen. Yang menang ketemu yang menang.',
    courtsLabel: 'Lapangan',
    pointsLabel: 'Poin per pertandingan',
    pointsHint: 'Dua skornya harus pas segini. Isi satu sisi, sisi satunya ikut.',
    metricLabel: 'Urutkan berdasarkan',
    metricPpr: 'Poin per ronde',
    metricTotal: 'Total poin',
    metricWins: 'Menang',
    metricPprHint:
      'Cuma poin per ronde yang adil buat yang datang telat dan yang kebagian duduk. Rata-rata poin sama, peringkat sama, mau datang jam berapa pun.',
    metricTotalHint:
      'Total poin memihak yang main lebih banyak ronde, jadi yang datang telat sudah ketinggalan dari awal.',
    metricWinsHint: 'Menang tidak lihat selisih. 13-11 sama saja dengan 24-0.',
    playersLabel: 'Pemain',
    playerNamePlaceholder: 'Nama pemain',
    addPlayer: 'Tambah',
    needFourPlayers: 'Minimal empat pemain. Tambah {count} lagi.',
    duplicateName: '{name} sudah ada di daftar.',
    start: 'Mulai turnamen',
    playersOnCourt: '{playing} main, {sitting} duduk tiap ronde',
    playersEvenFit: 'Semua main tiap ronde',
  },

  play: {
    title: 'Skor',
    roundHeading: 'Ronde {current}',
    roundOf: 'dari {total}',
    tapToScore: 'Ketuk lapangan untuk isi skornya',
    notScored: 'Belum diisi',
    sittingOut: 'Duduk dulu',
    nobodySittingOut: 'Semua lagi main',
    nextRound: 'Mulai ronde {next}',
    finishRoundFirst: 'Isi skor semua lapangan dulu',
    scheduleDone: 'Itu ronde terakhir. Klasemen sudah final.',
    emptyTitle: 'Belum ada ronde',
    emptyBody: 'Undi ronde pertama, lapangannya muncul di sini.',
    drawFirstRound: 'Undi ronde 1',
    notEnoughPlayers: 'Pemain aktif kurang dari empat, jadi tidak ada yang bisa diundi.',
    // Borrowed as-is: this is what gets shouted on an Indonesian court.
    matchPoint: 'Match point!',
  },

  score: {
    heading: 'Lapangan {court}',
    teamA: 'Tim A',
    teamB: 'Tim B',
    tapToAdd: 'Ketuk untuk tambah poin',
    holdToRemove: 'Tahan untuk kurangi satu',
    increment: 'Tambah poin buat {team}',
    decrement: 'Kurangi poin {team}',
    total: 'Totalnya {total}',
    clear: 'Kosongkan skor ini',
    saved: 'Tercatat',
  },

  players: {
    title: 'Pemain',
    open: 'Pemain',
    active: 'Main',
    paused: 'Jeda',
    left: 'Pulang',
    addTitle: 'Tambah pemain',
    addAction: 'Tambah pemain',
    nameLabel: 'Nama',
    seedLabel: 'Masuknya di level mana?',
    seedHint:
      'Cuma tebakan buat undian, sampai dia main satu ronde. Tidak pernah muncul di klasemen.',
    seedTop: 'Bareng yang di atas',
    seedMiddle: 'Di tengah-tengah',
    seedBottom: 'Bareng sisanya',
    joinsNextRound: 'Masuk ronde {round}',
    pause: 'Jeda',
    resume: 'Masukkan lagi',
    leave: 'Tandai pulang',
    substitute: 'Ganti',
    substituteTitle: 'Siapa yang gantikan {name}?',
    substituteHint:
      '{name} tetap pegang semua poin yang sudah dia kumpulkan. Pemain baru mulai dari nol dan isi tempat yang kosong.',
    substituteAction: 'Masukkan dia',
    statsFrozen: 'Statistik berhenti di ronde {round}',
    replacedBy: 'Diganti {name}',
    replaces: 'Pengganti {name}',
    lockedTitle: 'Ronde {round} sudah ada skornya',
    lockedBody: 'Perubahan pemain berlaku di ronde berikutnya, bukan yang ini.',
    emptyTitle: 'Belum ada siapa-siapa',
    emptyBody: 'Tambahkan yang sudah datang, mereka ikut undian berikutnya.',
  },

  board: {
    title: 'Klasemen',
    open: 'Klasemen',
    emptyTitle: 'Belum ada skor',
    emptyBody: 'Klasemen mulai terisi begitu skor lapangan pertama masuk.',
    rankedBy: 'Diurutkan berdasarkan {metric}',
    columnPlayer: 'Pemain',
    columnPlayed: 'Rnd',
    columnPoints: 'Poin',
    columnPpr: 'PPR',
    columnDiff: 'Selisih',
    leader: 'Memimpin',
    notEnoughRounds: 'Kurang ronde',
    // No plural rule needed in either language, for different reasons: English
    // uses the attributive form, Indonesian does not inflect at all.
    notEnoughRoundsHint:
      'Belum sampai batas {needed} ronde untuk naik podium, baru main {played}. Tetap masuk klasemen, cuma belum tiga besar.',
    podium: 'Tiga besar',
  },

  age: {
    justNow: 'barusan',
    seconds: '{count} detik lalu',
    minutes: '{count} menit lalu',
    hours: '{count} jam lalu',
  },

  share: {
    open: 'Bagikan klasemen',
    title: 'Bagikan klasemen',
    body: 'Siapa pun yang punya link ini bisa lihat klasemen. Mereka tidak bisa mengubah apa pun.',
    start: 'Buat link',
    creating: 'Membuat link',
    copy: 'Salin link',
    copied: 'Tersalin',
    copyFailed: 'Gagal menyalin. Pilih linknya lalu salin manual.',
    castHint: 'Buka linknya di tablet atau TV di tempat main, lalu pilih Tampilan layar.',
    pushPending: 'Belum terkirim. Nanti jalan sendiri begitu sinyal balik.',
    pushedAt: 'Terkirim {age}',
    pushFailed: 'Server menolak kiriman terakhir.',
    checking: 'Mencari server berbagi',
    unavailableTitle: 'Tidak ada server berbagi di sini',
    unavailableBody:
      'Catat skor tetap jalan tanpa koneksi sama sekali. Klasemen langsung butuh server tanteo, dan build ini tidak tersambung ke sana. Pasang sendiri servernya, berbagi langsung nyala.',
  },

  live: {
    pendingTitle: 'Link bagikan belum aktif',
    pendingBody:
      'Catat skor sudah jalan tanpa internet. Bagikan klasemen menyusul bareng server.',
    title: 'Klasemen langsung',
    loading: 'Membuka klasemen',
    missingTitle: 'Tidak ada klasemen di link ini',
    missingBody: 'Mungkin linknya salah, atau panitianya belum membagikan turnamen ini.',
    offlineTitle: 'Tidak nyambung ke klasemen',
    offlineBody: 'Perangkat ini sedang offline. Klasemen di bawah yang terakhir masuk.',
    errorTitle: 'Klasemen tidak bisa dibaca',
    errorBody: 'Server menjawab dengan sesuatu yang tidak bisa dipakai tanteo.',
    updated: 'Diperbarui {age}',
    waiting: 'Menunggu skor pertama',
    stalled: 'Putus kontak dengan panitia. Klasemen ini mungkin sudah ketinggalan.',
    quiet: 'Tersambung. Sudah lama tidak ada skor masuk.',
    connectionLive: 'Langsung',
    connectionPolling: 'Cek tiap beberapa detik',
    standings: 'Klasemen',
    currentRound: 'Lagi di lapangan',
    castView: 'Tampilan layar',
    phoneView: 'Tampilan HP',
    castHint: 'Gantian menampilkan klasemen dan lapangan, buat layar di tempat main.',
  },

  errors: {
    storageTitle: 'Tidak bisa akses penyimpanan browser',
    storageBody:
      'tanteo menyimpan turnamenmu di perangkat ini. Mode incognito atau setelan penyimpanan yang diblokir bikin ini gagal.',
    genericTitle: 'Ada yang salah',
    // Shown instead of the engine's own sentence, which is developer English
    // and would survive translation untouched.
    genericBody: 'tanteo menolak perubahan itu. Tidak ada yang hilang, coba lagi.',
    detailCode: 'Kode: {code}',
    notFoundTitle: 'Halaman tidak ada',
    notFoundBody: 'Alamat itu tidak menuju ke mana-mana di tanteo.',
    bootBody:
      'tanteo tidak bisa membuka turnamen yang tersimpan. Biasanya beres setelah dimuat ulang.',
    scoreInvalid: 'Dua skornya harus pas {total}.',
    historyLocked: 'Ronde itu sudah ada skornya, jadi tidak bisa diundi ulang.',
    unknownPlayer: 'Pemain itu tidak ada di turnamen ini.',
    duplicatePlayer: 'Sudah ada orang dengan nama itu.',
  },
};
