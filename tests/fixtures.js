// Test fixtures: real cards in Scryfall's API shape, plus a synthetic generator for scale tests.
import { createHash } from 'node:crypto';

const uuid = (s) => {
  const h = createHash('md5').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const COLORS = ['W', 'U', 'B', 'R', 'G'];
const cmcOf = (cost) => [...(cost || '').matchAll(/\{([^}]+)\}/g)].reduce((a, [, s]) => a + (/^\d+$/.test(s) ? +s : s === 'X' ? 0 : 1), 0);
const colorsOf = (s) => COLORS.filter((c) => new RegExp(`\\{[^}]*${c}[^}]*\\}`).test(s || ''));
const KW = ['Flying', 'Haste', 'Trample', 'Vigilance', 'Lifelink', 'Deathtouch', 'First strike', 'Double strike', 'Flash', 'Menace', 'Reach', 'Hexproof', 'Indestructible', 'Partner', 'Ward', 'Prowess', 'Changeling'];

// [name, cost, type, text, edhrecRank, pt?, produced?]
const RAW = [
  // colourless
  ['Sol Ring', '{1}', 'Artifact', '{T}: Add {C}{C}.', 1, null, ['C']],
  ['Arcane Signet', '{2}', 'Artifact', "{T}: Add one mana of any color in your commander's color identity.", 3, null, COLORS],
  ['Mind Stone', '{2}', 'Artifact', '{T}: Add {C}.\n{1}, {T}, Sacrifice Mind Stone: Draw a card.', 60, null, ['C']],
  ['Fellwar Stone', '{2}', 'Artifact', '{T}: Add one mana of any color that a land an opponent controls could produce.', 90, null, COLORS],
  ["Commander's Sphere", '{3}', 'Artifact', "{T}: Add one mana of any color in your commander's color identity.\nSacrifice Commander's Sphere: Draw a card.", 70, null, COLORS],
  ['Lightning Greaves', '{2}', 'Artifact — Equipment', 'Whenever a creature enters the battlefield under your control, you may attach Lightning Greaves to it.\nEquipped creature has haste and shroud.\nEquip {0}', 25],
  ['Swiftfoot Boots', '{2}', 'Artifact — Equipment', 'Equipped creature has hexproof and haste.\nEquip {1}', 20],
  ['Skullclamp', '{1}', 'Artifact — Equipment', 'Equipped creature gets +1/-1.\nWhenever equipped creature dies, draw two cards.\nEquip {1}', 80],
  ['Solemn Simulacrum', '{4}', 'Artifact Creature — Golem', 'When Solemn Simulacrum enters the battlefield, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.\nWhen Solemn Simulacrum dies, you may draw a card.', 40, ['2', '2']],
  ['Burnished Hart', '{3}', 'Artifact Creature — Elk', '{3}, Sacrifice Burnished Hart: Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.', 300, ['2', '2']],
  ['Wayfarer\'s Bauble', '{1}', 'Artifact', '{2}, {T}, Sacrifice Wayfarer\'s Bauble: Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.', 110],
  ['Thought Vessel', '{2}', 'Artifact', 'You have no maximum hand size.\n{T}: Add {C}.', 250, null, ['C']],
  // lands
  ['Command Tower', '', 'Land', "{T}: Add one mana of any color in your commander's color identity.", 2, null, COLORS],
  ['Reliquary Tower', '', 'Land', 'You have no maximum hand size.\n{T}: Add {C}.', 50, null, ['C']],
  ["Rogue's Passage", '', 'Land', "{T}: Add {C}.\n{4}, {T}: Target creature can't be blocked this turn.", 45, null, ['C']],
  ['Myriad Landscape', '', 'Land', 'Myriad Landscape enters the battlefield tapped.\n{T}: Add {C}.\n{2}, {T}, Sacrifice Myriad Landscape: Search your library for up to two basic land cards that share a land type, put them onto the battlefield tapped, then shuffle.', 120, null, ['C']],
  ['Evolving Wilds', '', 'Land', '{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.', 30],
  ['Terramorphic Expanse', '', 'Land', '{T}, Sacrifice Terramorphic Expanse: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.', 35],
  ['Exotic Orchard', '', 'Land', '{T}: Add one mana of any color that a land an opponent controls could produce.', 28, null, COLORS],
  ['Path of Ancestry', '', 'Land', "Path of Ancestry enters the battlefield tapped.\n{T}: Add one mana of any color in your commander's color identity.", 26, null, COLORS],
  ['Hallowed Fountain', '', 'Land — Plains Island', '({T}: Add {W} or {U}.)\nAs Hallowed Fountain enters the battlefield, you may pay 2 life. If you don\'t, it enters the battlefield tapped.', 150, null, ['W', 'U']],
  ['Watery Grave', '', 'Land — Island Swamp', '({T}: Add {U} or {B}.)\nAs Watery Grave enters the battlefield, you may pay 2 life. If you don\'t, it enters the battlefield tapped.', 140, null, ['U', 'B']],
  ['Breeding Pool', '', 'Land — Forest Island', '({T}: Add {G} or {U}.)\nAs Breeding Pool enters the battlefield, you may pay 2 life. If you don\'t, it enters the battlefield tapped.', 130, null, ['G', 'U']],
  ['Simic Growth Chamber', '', 'Land', 'Simic Growth Chamber enters the battlefield tapped.\nWhen Simic Growth Chamber enters the battlefield, return a land you control to its owner\'s hand.\n{T}: Add {G}{U}.', 400, null, ['G', 'U']],
  ['Yavimaya Coast', '', 'Land', '{T}: Add {C}.\n{T}: Add {G} or {U}. Yavimaya Coast deals 1 damage to you.', 260, null, ['C', 'G', 'U']],
  ['Hinterland Harbor', '', 'Land', 'Hinterland Harbor enters the battlefield tapped unless you control a Forest or an Island.\n{T}: Add {G} or {U}.', 270, null, ['G', 'U']],
  ['Rootbound Crag', '', 'Land', 'Rootbound Crag enters the battlefield tapped unless you control a Mountain or a Forest.\n{T}: Add {R} or {G}.', 280, null, ['R', 'G']],
  ['Drowned Catacomb', '', 'Land', 'Drowned Catacomb enters the battlefield tapped unless you control an Island or a Swamp.\n{T}: Add {U} or {B}.', 290, null, ['U', 'B']],
  ['Woodland Cemetery', '', 'Land', 'Woodland Cemetery enters the battlefield tapped unless you control a Swamp or a Forest.\n{T}: Add {B} or {G}.', 295, null, ['B', 'G']],
  ['Plains', '', 'Basic Land — Plains', '({T}: Add {W}.)', null, null, ['W']],
  ['Island', '', 'Basic Land — Island', '({T}: Add {U}.)', null, null, ['U']],
  ['Swamp', '', 'Basic Land — Swamp', '({T}: Add {B}.)', null, null, ['B']],
  ['Mountain', '', 'Basic Land — Mountain', '({T}: Add {R}.)', null, null, ['R']],
  ['Forest', '', 'Basic Land — Forest', '({T}: Add {G}.)', null, null, ['G']],
  ['Wastes', '', 'Basic Land', '{T}: Add {C}.', null, null, ['C']],
  // commanders
  ['Talrand, Sky Summoner', '{2}{U}{U}', 'Legendary Creature — Merfolk Wizard', 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.', 900, ['2', '2']],
  ['Krenko, Mob Boss', '{2}{R}{R}', 'Legendary Creature — Goblin Warrior', '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.', 500, ['3', '3']],
  ['Ezuri, Renegade Leader', '{1}{G}{G}', 'Legendary Creature — Elf Warrior', '{G}: Regenerate another target Elf.\n{2}{G}{G}{G}: Elf creatures you control get +3/+3 and gain trample until end of turn.', 1500, ['2', '2']],
  ['Tatyova, Benthic Druid', '{3}{G}{U}', 'Legendary Creature — Merfolk Druid', 'Landfall — Whenever a land enters the battlefield under your control, you gain 1 life and draw a card.', 700, ['3', '3']],
  ['Meren of Clan Nel Toth', '{2}{B}{G}', 'Legendary Creature — Human Shaman', 'Whenever another creature you control dies, you get an experience counter.\nAt the beginning of your end step, choose target creature card in your graveyard. If that card\'s mana value is less than or equal to the number of experience counters you have, return that card to the battlefield. Otherwise, put it into your hand.', 800, ['3', '4']],
  ['Thrasios, Triton Hero', '{G}{U}', 'Legendary Creature — Merfolk Wizard', '{4}: Scry 1, then reveal the top card of your library. If it\'s a land card, put it onto the battlefield tapped. Otherwise, draw a card.\nPartner', 1100, ['1', '3']],
  ['Tymna the Weaver', '{1}{W}{B}', 'Legendary Creature — Human Cleric', 'Lifelink\nAt the beginning of your postcombat main phase, you may pay X life, where X is the number of opponents that were dealt combat damage this turn. If you do, draw X cards.\nPartner', 1200, ['2', '2']],
  // blue
  ['Counterspell', '{U}{U}', 'Instant', 'Counter target spell.', 10],
  ['Arcane Denial', '{1}{U}', 'Instant', 'Counter target spell. Its controller may draw up to two cards at the beginning of the next turn\'s upkeep.', 75],
  ['Swan Song', '{U}', 'Instant', 'Counter target enchantment, instant, or sorcery spell. Its controller creates a 2/2 blue Bird creature token with flying.', 100],
  ['Brainstorm', '{U}', 'Instant', 'Draw three cards, then put two cards from your hand on top of your library in any order.', 55],
  ['Ponder', '{U}', 'Sorcery', 'Look at the top three cards of your library, then put them back in any order. You may shuffle.\nDraw a card.', 65],
  ['Preordain', '{U}', 'Sorcery', 'Scry 2, then draw a card.', 85],
  ['Opt', '{U}', 'Instant', 'Scry 1.\nDraw a card.', 160],
  ['Rhystic Study', '{2}{U}', 'Enchantment', 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.', 12],
  ['Mystic Remora', '{U}', 'Enchantment', 'Cumulative upkeep {1}\nWhenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.', 95],
  ['Cyclonic Rift', '{1}{U}', 'Instant', 'Return target nonland permanent you don\'t control to its owner\'s hand.\nOverload {6}{U}', 15],
  ['Pongify', '{U}', 'Instant', 'Destroy target creature. It can\'t be regenerated. Its controller creates a 3/3 green Ape creature token.', 180],
  ['Rapid Hybridization', '{U}', 'Instant', 'Destroy target creature. It can\'t be regenerated. That creature\'s controller creates a 3/3 green Frog Lizard creature token.', 190],
  ['Fact or Fiction', '{3}{U}', 'Instant', 'Reveal the top five cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.', 230],
  ['Frantic Search', '{2}{U}', 'Instant', 'Draw two cards, then discard two cards. Untap up to three lands.', 330],
  ['Mulldrifter', '{4}{U}', 'Creature — Elemental', 'Flying\nWhen Mulldrifter enters the battlefield, draw two cards.\nEvoke {2}{U}', 210, ['2', '2']],
  ['Consecrated Sphinx', '{4}{U}{U}', 'Creature — Sphinx', 'Flying\nWhenever an opponent draws a card, you may draw two cards.', 240, ['4', '6']],
  ['Archmage Emeritus', '{2}{U}{U}', 'Creature — Human Wizard', 'Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.', 350, ['2', '2']],
  ['Murmuring Mystic', '{3}{U}', 'Creature — Human Wizard', 'Whenever you cast an instant or sorcery spell, create a 1/1 blue Bird Illusion creature token with flying.', 400, ['1', '5']],
  ['Lord of Atlantis', '{U}{U}', 'Creature — Merfolk', 'Other Merfolk get +1/+1 and have islandwalk.', 1300, ['2', '2']],
  ['Master of the Pearl Trident', '{U}{U}', 'Creature — Merfolk', 'Other Merfolk creatures you control get +1/+1 and have islandwalk.', 1600, ['2', '2']],
  ['Silvergill Adept', '{1}{U}', 'Creature — Merfolk Wizard', 'As an additional cost to cast this spell, reveal a Merfolk card from your hand or pay {3}.\nWhen Silvergill Adept enters the battlefield, draw a card.', 1700, ['2', '1']],
  ['Merrow Reejerey', '{2}{U}', 'Creature — Merfolk Soldier', 'Other Merfolk creatures you control get +1/+1.\nWhenever you cast a Merfolk spell, you may tap or untap target permanent.', 1800, ['2', '2']],
  ['Kumena\'s Speaker', '{G}', 'Creature — Merfolk Shaman', 'Kumena\'s Speaker gets +1/+1 as long as you control another Merfolk or an Island.', 2500, ['1', '1']],
  ['Spellstutter Sprite', '{1}{U}', 'Creature — Faerie Wizard', 'Flash\nFlying\nWhen Spellstutter Sprite enters the battlefield, counter target spell with mana value X or less, where X is the number of Faeries you control.', 1900, ['1', '1']],
  ['Ledger Shredder', '{1}{U}', 'Creature — Bird Advisor', 'Flying\nWhenever a player casts their second spell each turn, Ledger Shredder connives.', 600, ['1', '3']],
  // green
  ['Llanowar Elves', '{G}', 'Creature — Elf Druid', '{T}: Add {G}.', 120, ['1', '1'], ['G']],
  ['Elvish Mystic', '{G}', 'Creature — Elf Druid', '{T}: Add {G}.', 125, ['1', '1'], ['G']],
  ['Fyndhorn Elves', '{G}', 'Creature — Elf Druid', '{T}: Add {G}.', 220, ['1', '1'], ['G']],
  ['Elvish Archdruid', '{1}{G}{G}', 'Creature — Elf Druid', 'Other Elf creatures you control get +1/+1.\n{T}: Add {G} for each Elf you control.', 500, ['2', '2'], ['G']],
  ['Priest of Titania', '{1}{G}', 'Creature — Elf Druid', '{T}: Add {G} for each Elf on the battlefield.', 520, ['1', '1'], ['G']],
  ['Elvish Visionary', '{1}{G}', 'Creature — Elf Shaman', 'When Elvish Visionary enters the battlefield, draw a card.', 900, ['1', '1']],
  ['Wood Elves', '{2}{G}', 'Creature — Elf Scout', 'When Wood Elves enters the battlefield, search your library for a Forest card, put that card onto the battlefield, then shuffle.', 310, ['1', '1']],
  ['Cultivate', '{2}{G}', 'Sorcery', 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.', 8],
  ["Kodama's Reach", '{2}{G}', 'Sorcery — Arcane', 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.', 9],
  ['Rampant Growth', '{1}{G}', 'Sorcery', 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.', 14],
  ['Farseek', '{1}{G}', 'Sorcery', 'Search your library for a Plains, Island, Swamp, or Mountain card, put it onto the battlefield tapped, then shuffle.', 33],
  ["Nature's Lore", '{1}{G}', 'Sorcery', 'Search your library for a Forest card, put that card onto the battlefield, then shuffle.', 22],
  ['Three Visits', '{1}{G}', 'Sorcery', 'Search your library for a Forest card, put it onto the battlefield, then shuffle.', 27],
  ['Beast Within', '{2}{G}', 'Instant', 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.', 18],
  ['Krosan Grip', '{2}{G}', 'Instant', 'Split second\nDestroy target artifact or enchantment.', 170],
  ['Return to Nature', '{1}{G}', 'Instant', 'Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.\n• Exile target card from a graveyard.', 340],
  ['Beast Whisperer', '{2}{G}{G}', 'Creature — Elf Druid', 'Whenever you cast a creature spell, draw a card.', 360, ['2', '3']],
  ['Guardian Project', '{3}{G}', 'Enchantment', 'Whenever a nontoken creature enters the battlefield under your control, if it doesn\'t have the same name as another creature you control or a creature card in your graveyard, draw a card.', 200],
  ['Harmonize', '{2}{G}{G}', 'Sorcery', 'Draw three cards.', 260],
  ['Sylvan Library', '{1}{G}', 'Enchantment', 'At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.', 150],
  ['Craterhoof Behemoth', '{5}{G}{G}{G}', 'Creature — Beast', 'Haste\nWhen Craterhoof Behemoth enters the battlefield, creatures you control gain trample and get +X/+X until end of turn, where X is the number of creatures you control.', 280, ['5', '5']],
  ['Avenger of Zendikar', '{5}{G}{G}', 'Creature — Elemental', 'When Avenger of Zendikar enters the battlefield, create a 0/1 green Plant creature token for each land you control.\nLandfall — Whenever a land enters the battlefield under your control, you may put a +1/+1 counter on each Plant creature you control.', 290, ['5', '5']],
  ['Lotus Cobra', '{1}{G}', 'Creature — Snake', 'Landfall — Whenever a land enters the battlefield under your control, add one mana of any color.', 450, ['2', '1']],
  ['Courser of Kruphix', '{1}{G}{G}', 'Enchantment Creature — Centaur', 'Play with the top card of your library revealed.\nYou may play lands from the top of your library.\nLandfall — Whenever a land enters the battlefield under your control, you gain 1 life.', 600, ['2', '4']],
  ['Eternal Witness', '{1}{G}{G}', 'Creature — Human Shaman', 'When Eternal Witness enters the battlefield, return target card from your graveyard to your hand.', 100, ['2', '1']],
  ['Heroic Intervention', '{1}{G}', 'Instant', 'Permanents you control gain hexproof and indestructible until end of turn.', 40],
  ['Evolution Sage', '{2}{G}', 'Creature — Elf Druid', 'Landfall — Whenever a land enters the battlefield under your control, proliferate.', 800, ['3', '2']],
  ['Hardened Scales', '{G}', 'Enchantment', 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.', 650],
  // red
  ['Lightning Bolt', '{R}', 'Instant', 'Lightning Bolt deals 3 damage to any target.', 140],
  ['Shock', '{R}', 'Instant', 'Shock deals 2 damage to any target.', 700],
  ['Chaos Warp', '{2}{R}', 'Instant', 'The owner of target permanent shuffles it into their library, then reveals the top card of their library. If it\'s a permanent card, they may put it onto the battlefield.', 60],
  ['Blasphemous Act', '{8}{R}', 'Sorcery', 'This spell costs {1} less to cast for each creature on the battlefield.\nBlasphemous Act deals 13 damage to each creature.', 70],
  ['Vandalblast', '{R}', 'Sorcery', 'Destroy target artifact you don\'t control.\nOverload {4}{R}', 160],
  ['Abrade', '{1}{R}', 'Instant', 'Choose one —\n• Abrade deals 3 damage to target creature.\n• Destroy target artifact.', 420],
  ['Goblin Chieftain', '{1}{R}{R}', 'Creature — Goblin', 'Haste\nOther Goblin creatures you control get +1/+1 and have haste.', 1400, ['2', '2']],
  ['Goblin Instigator', '{1}{R}', 'Creature — Goblin Rogue', 'When Goblin Instigator enters the battlefield, create a 1/1 red Goblin creature token.', 1000, ['1', '1']],
  ['Beetleback Chief', '{2}{R}{R}', 'Creature — Goblin Warrior', 'When Beetleback Chief enters the battlefield, create two 1/1 red Goblin creature tokens.', 1100, ['2', '2']],
  ['Siege-Gang Commander', '{3}{R}{R}', 'Creature — Goblin', 'When Siege-Gang Commander enters the battlefield, create three 1/1 red Goblin creature tokens.\n{1}{R}, Sacrifice a Goblin: Siege-Gang Commander deals 2 damage to any target.', 900, ['2', '2']],
  ['Skirk Prospector', '{R}', 'Creature — Goblin', 'Sacrifice a Goblin: Add {R}.', 1500, ['1', '1'], ['R']],
  ['Goblin Matron', '{2}{R}', 'Creature — Goblin', 'When Goblin Matron enters the battlefield, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.', 1600, ['1', '1']],
  ['Mogg War Marshal', '{1}{R}', 'Creature — Goblin Warrior', 'Echo {1}{R}\nWhen Mogg War Marshal enters the battlefield or dies, create a 1/1 red Goblin creature token.', 1650, ['1', '1']],
  ['Impact Tremors', '{1}{R}', 'Enchantment', 'Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent.', 380],
  ['Faithless Looting', '{R}', 'Sorcery', 'Draw two cards, then discard two cards.\nFlashback {2}{R}', 480],
  ['Monastery Swiftspear', '{R}', 'Creature — Human Monk', 'Haste\nProwess', 2200, ['1', '2']],
  ['Goblin Guide', '{R}', 'Creature — Goblin Scout', 'Haste\nWhenever Goblin Guide attacks, defending player reveals the top card of their library. If it\'s a land card, that player puts it into their hand.', 2300, ['2', '2']],
  ['Young Pyromancer', '{1}{R}', 'Creature — Human Shaman', 'Whenever you cast an instant or sorcery spell, create a 1/1 red Elemental creature token.', 800, ['2', '1']],
  // black
  ['Doom Blade', '{1}{B}', 'Instant', 'Destroy target nonblack creature.', 210],
  ['Go for the Throat', '{1}{B}', 'Instant', 'Destroy target nonartifact creature.', 110],
  ['Damnation', '{2}{B}{B}', 'Sorcery', 'Destroy all creatures. They can\'t be regenerated.', 160],
  ['Toxic Deluge', '{2}{B}', 'Sorcery', 'As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.', 90],
  ["Night's Whisper", '{1}{B}', 'Sorcery', 'You draw two cards and you lose 2 life.', 130],
  ['Sign in Blood', '{B}{B}', 'Sorcery', 'Target player draws two cards and loses 2 life.', 190],
  ['Phyrexian Arena', '{1}{B}{B}', 'Enchantment', 'At the beginning of your upkeep, you draw a card and you lose 1 life.', 100],
  ['Demonic Tutor', '{1}{B}', 'Sorcery', 'Search your library for a card, put that card into your hand, then shuffle.', 50],
  ['Animate Dead', '{1}{B}', 'Enchantment — Aura', 'Enchant creature card in a graveyard\nWhen Animate Dead enters the battlefield, if it\'s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with Animate Dead." Return enchanted creature card to the battlefield under your control and attach Animate Dead to it.', 150],
  ['Reanimate', '{B}', 'Sorcery', 'Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.', 170],
  ['Fleshbag Marauder', '{2}{B}', 'Creature — Zombie Warrior', 'When Fleshbag Marauder enters the battlefield, each player sacrifices a creature.', 600, ['3', '1']],
  ['Viscera Seer', '{B}', 'Creature — Vampire Wizard', 'Sacrifice a creature: Scry 1.', 300, ['1', '1']],
  ['Blood Artist', '{1}{B}', 'Creature — Vampire', 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.', 200, ['0', '1']],
  ['Zulaport Cutthroat', '{1}{B}', 'Creature — Human Rogue Ally', 'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.', 250, ['1', '1']],
  ['Grave Titan', '{4}{B}{B}', 'Creature — Giant', 'Deathtouch\nWhenever Grave Titan enters the battlefield or attacks, create two 2/2 black Zombie creature tokens.', 350, ['6', '6']],
  ['Gray Merchant of Asphodel', '{3}{B}{B}', 'Creature — Zombie', 'When Gray Merchant of Asphodel enters the battlefield, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way.', 330, ['2', '4']],
  // white
  ['Swords to Plowshares', '{W}', 'Instant', 'Exile target creature. Its controller gains life equal to its power.', 5],
  ['Path to Exile', '{W}', 'Instant', 'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.', 16],
  ['Wrath of God', '{2}{W}{W}', 'Sorcery', 'Destroy all creatures. They can\'t be regenerated.', 150],
  ['Generous Gift', '{2}{W}', 'Instant', 'Destroy target permanent. Its controller creates a 3/3 green Elephant creature token.', 45],
  ["Teferi's Protection", '{2}{W}', 'Instant', 'Until your next turn, your life total can\'t change and you gain protection from everything. All permanents you control phase out.', 60],
  ['Smothering Tithe', '{3}{W}', 'Enchantment', 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.', 20],
  ['Soul Warden', '{W}', 'Creature — Human Cleric', 'Whenever another creature enters the battlefield, you gain 1 life.', 700, ['1', '1']],
  ["Ajani's Pridemate", '{1}{W}', 'Creature — Cat Soldier', 'Whenever you gain life, you may put a +1/+1 counter on Ajani\'s Pridemate.', 750, ['2', '2']],
  ['Raise the Alarm', '{1}{W}', 'Instant', 'Create two 1/1 white Soldier creature tokens.', 1200],
  ['Intangible Virtue', '{1}{W}', 'Enchantment', 'Creature tokens you control get +1/+1 and have vigilance.', 1100],
  ['Anointed Procession', '{3}{W}', 'Enchantment', 'If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.', 300],
  ["Elspeth, Sun's Champion", '{4}{W}{W}', 'Legendary Planeswalker — Elspeth', '+1: Create three 1/1 white Soldier creature tokens.\n−3: Destroy all creatures with power 4 or greater.', 400],
  // multicolour / double-faced
  ['Growth Spiral', '{G}{U}', 'Instant', 'Draw a card. You may put a land card from your hand onto the battlefield.', 210],
  ['Mystic Snake', '{1}{G}{U}{U}', 'Creature — Snake', 'Flash\nWhen Mystic Snake enters the battlefield, counter target spell.', 500, ['2', '2']],
  ['Coiling Oracle', '{G}{U}', 'Creature — Snake Elf Druid', 'When Coiling Oracle enters the battlefield, reveal the top card of your library. If it\'s a land card, put it onto the battlefield. Otherwise, put that card into your hand.', 520, ['1', '1']],
];

function makeCard([name, cost, type, text, rank, pt, produced]) {
  const kws = KW.filter((k) => new RegExp(`(^|\\n)${k}\\b`).test(text));
  const identity = [...new Set([...colorsOf(cost), ...colorsOf(text.replace(/\([^)]*\)/g, ''))])];
  if (/\bLand\b/.test(type) && produced && produced.length < 5) produced.filter((p) => COLORS.includes(p)).forEach((p) => { if (!identity.includes(p)) identity.push(p); });
  const legalAll = { standard: 'not_legal', pioneer: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal', commander: 'legal', pauper: 'not_legal' };
  if (name === 'Mystic Remora' || name === 'Demonic Tutor') legalAll.vintage = 'restricted';
  return {
    object: 'card', id: uuid('print:' + name), oracle_id: uuid('oracle:' + name), name, lang: 'en', layout: 'normal',
    mana_cost: cost, cmc: cmcOf(cost), type_line: type, oracle_text: text,
    colors: colorsOf(cost), color_identity: COLORS.filter((c) => identity.includes(c)), keywords: kws,
    produced_mana: produced || undefined, power: pt ? pt[0] : undefined, toughness: pt ? pt[1] : undefined,
    legalities: legalAll, set: 'tst', collector_number: String(RAW.findIndex((r) => r[0] === name) + 1), rarity: 'rare',
    edhrec_rank: rank ?? undefined, prices: { usd: (Math.round(Math.random() * 500) / 100).toFixed(2), eur: null },
    image_uris: { small: 'https://cards.scryfall.io/small/x.jpg', normal: 'https://cards.scryfall.io/normal/x.jpg', art_crop: 'https://cards.scryfall.io/art_crop/x.jpg' },
    scryfall_uri: 'https://scryfall.com/card/tst/1',
  };
}

export const REAL_CARDS = RAW.map(makeCard);

// A double-faced card, to exercise card_faces handling.
REAL_CARDS.push({
  object: 'card', id: uuid('print:Delver'), oracle_id: uuid('oracle:Delver'), name: 'Delver of Secrets // Insectile Aberration',
  layout: 'transform', cmc: 1, type_line: 'Creature — Human Wizard // Creature — Human Insect', color_identity: ['U'], keywords: ['Flying', 'Transform'],
  legalities: { commander: 'legal', vintage: 'legal', pauper: 'legal' }, set: 'tst', collector_number: '999', rarity: 'common', edhrec_rank: 5000,
  prices: { usd: '0.25' },
  card_faces: [
    { name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard', oracle_text: 'At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform Delver of Secrets.', colors: ['U'], power: '1', toughness: '1', image_uris: { normal: 'https://cards.scryfall.io/normal/front/d.jpg', small: 's', art_crop: 'a' } },
    { name: 'Insectile Aberration', mana_cost: '', type_line: 'Creature — Human Insect', oracle_text: 'Flying', colors: ['U'], power: '3', toughness: '2', image_uris: { normal: 'https://cards.scryfall.io/normal/back/d.jpg', small: 's', art_crop: 'a' } },
  ],
});

// ---------- synthetic generator ----------
const TRIBES = { W: ['Soldier', 'Cleric', 'Angel'], U: ['Merfolk', 'Wizard', 'Drake'], B: ['Zombie', 'Vampire', 'Rogue'], R: ['Goblin', 'Dragon', 'Warrior'], G: ['Elf', 'Beast', 'Druid'] };
const TEMPLATES = [
  (c) => ({ type: 'Instant', text: 'Destroy target creature.', role: 'removal' }),
  (c) => ({ type: 'Sorcery', text: 'Draw two cards.', role: 'draw' }),
  (c) => ({ type: 'Artifact', text: `{T}: Add {${c}}.`, role: 'ramp', produced: [c] }),
  (c) => ({ type: 'Sorcery', text: 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.', role: 'ramp' }),
  (c) => ({ type: 'Enchantment', text: 'Whenever a creature enters the battlefield under your control, you gain 1 life.', role: 'theme' }),
  (c) => ({ type: 'Instant', text: 'Create two 1/1 creature tokens.', role: 'tokens' }),
  (c) => ({ type: 'Sorcery', text: 'Destroy all creatures.', role: 'wipe' }),
  (c) => ({ type: 'Instant', text: 'Counter target spell.', role: 'counter' }),
];

/** Generate `perColour` synthetic cards per colour plus some gold cards and dual lands. */
export function syntheticCards(perColour = 120, seed = 7) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = [];
  let n = 0;
  for (const c of COLORS) {
    for (let i = 0; i < perColour; i++) {
      const cmc = 1 + Math.floor(r() * 6);
      const cost = `{${Math.max(0, cmc - 1)}}{${c}}`.replace('{0}', '');
      const isCre = r() < 0.55;
      let type, text, pt;
      if (isCre) {
        const tribe = TRIBES[c][Math.floor(r() * 3)];
        type = `Creature — ${tribe}`;
        const extras = ['Flying', 'Haste', 'Trample', 'Lifelink', `When this creature enters the battlefield, draw a card.`, `Other ${tribe} creatures you control get +1/+1.`, 'Whenever another creature you control dies, each opponent loses 1 life.', 'Put a +1/+1 counter on target creature.'];
        text = extras[Math.floor(r() * extras.length)];
        pt = [String(Math.max(1, cmc - 1 + Math.floor(r() * 2))), String(Math.max(1, cmc - Math.floor(r() * 2)))];
      } else {
        const t = TEMPLATES[Math.floor(r() * TEMPLATES.length)](c);
        type = t.type; text = t.text;
      }
      const name = `Synth ${c} ${++n}`;
      out.push({ ...makeCard([name, cost, type, text, Math.floor(r() * 25000) + 500, pt]), collector_number: String(n) });
    }
  }
  return out;
}
