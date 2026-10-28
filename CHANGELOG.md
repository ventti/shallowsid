# Changelog

## 0.4.0 - 2026-10-28

### feat

- clarify privacy and simplify sync and ROM settings ([`8cdc21d`](../../commit/8cdc21d20b0836b3d761710ce9c1766ebf33dc91))

### docs

- clarify encrypted data rights and key recovery ([`39667ca`](../../commit/39667ca1f4d2d4796ea1d8eee1aa1eb34656297a))
- clarify privacy notice and data handling ([`422046e`](../../commit/422046ebf86c5fd888673e9d922e13305cccf7ef))

## 0.3.0 - 2026-10-27

### feat

- **release:** version production deploys and link release notes ([`5bc9972`](../../commit/5bc99726bdbc27ab24e6f80e5a722ba1eadc3b02))
- **search:** add shareable searches and playlist actions ([`3771b4e`](../../commit/3771b4e798849b08fc953a49efdad95f1d2f2f17))
- **search:** add title, release, and composer filters ([`950bc40`](../../commit/950bc40fa782580ada80d3ecea837e396bcdfef1))
- add settings help and integrate About into app navigation ([`1afaf37`](../../commit/1afaf37c1ec814050bf517f2a724a7f1e2472e97))
- **lists:** let admins manage the curated lists (#9) ([`362ae47`](../../commit/362ae47eb1c510efbc5ae2e43ce504c4b2d7a956))
- **now-playing:** show the ShallowSID logo on the empty cover ([`26fec3b`](../../commit/26fec3ba4dbedc7c61df5b1bc692bdc695c6e588))
- **icons:** use the ShallowSID logo as the Home tab icon ([`e1b0451`](../../commit/e1b045172c28a3c8396a86aae3c9b6cdbe366e35))
- **tags:** show admin tags as chips grouped by category ([`23dedf9`](../../commit/23dedf9b10fa8bd7d4c2de806a748dc3d52542e7))
- **tags:** list and edit all tags, keep edits pending until deployed ([`adfeeaa`](../../commit/adfeeaa2ac87c7fd2522e61396e85c85b666f32d))
- **notices:** show a welcome notice to new users ([`1cf3de1`](../../commit/1cf3de19694b9d88913162cec749370b59129e5c))
- **roms:** use icon buttons and add copyright note to C64 ROMs settings ([`f33d638`](../../commit/f33d6385c78ded462feb9d79a8bc01c4fce8cc80))
- **sound:** show whether the Ultimate is reachable ([`27012d2`](../../commit/27012d206d5aceeaa65289f06cb0715ef34cf3f0))
- **player:** show play/stop instead of play/pause on the Ultimate ([`ae8c899`](../../commit/ae8c8994de0d454d57ff063ce5ed69e5b01695a1))
- **sound:** switch to SIDLite without a notice ([`d869987`](../../commit/d86998753e8e6320061e6f6b326307babdab4167))
- **sound:** switch slow devices to SIDLite unless an engine was picked ([`22329b3`](../../commit/22329b32706f6979648a6d609eb2a5272bd3530c))
- **sound:** add SIDLite engine and Ultimate 64 output ([`a962bb6`](../../commit/a962bb63840c789e507596a39f661577c6896c2d))
- **tags:** add catchy mood ([`58ff39c`](../../commit/58ff39cca86d884a9958b6780ddd6c752aee762e))
- **covers:** tint each cover with its composer's colour on a soft gradient, shared with their critter ([`aec5255`](../../commit/aec52554c0ecc115ac727921e727123256c89d19))
- **covers:** draw the sprite at the same size in its tile on every cover ([`b09bc2f`](../../commit/b09bc2f020caab44f8db2eca2b0b76e64f593106))
- **covers:** draw the tune sprite smaller in list covers, with a content option in pixelavatar ([`6186c27`](../../commit/6186c27f98cb00a07769b44ac486b66bc5341718))
- **tags:** add ragtime style ([`b8060ef`](../../commit/b8060efd3de90f8506692a114ad574cf4162420a))
- **tags:** add dramatic mood and r&b style ([`e2a4001`](../../commit/e2a400148dd758c72ad6daffa02391c9a78af2af))
- **lists:** show a tune's tags in result rows where they fit ([`c4ca095`](../../commit/c4ca0950ae6fe1216044fa20addb8823ec849297))
- **catalogue:** show and search each subtune's play speed, timing and SID features ([`c672694`](../../commit/c672694077a7e7f71480809f28c9fa4a5a37e988))
- **tools:** add sidfeatures for each subtune's play speed, timing, filter, ring, sync, digi and BASIC ([`79a02e2`](../../commit/79a02e25d77bb71b07e45d00b612d002a0213801))
- **notices:** add scheduled notices with a sync and data export move notice, and user data import/export ([`4d0b3e4`](../../commit/4d0b3e4080bff709f63578f6994d3d7ff4962e95))
- **tools:** add run_hvsc.sh, and size bpm.py's workers to the cores it may use ([`f8ca9f1`](../../commit/f8ca9f14dc401f773428f2f8e4dc4e3db1fd9408))
- **tags:** add a Eurodance tag ([`8e848f8`](../../commit/8e848f8665a57c3d8198379b6f532652127f17cb))
- **search:** filter by bpm, length, year and subtunes with comparisons ([`c12c3bb`](../../commit/c12c3bb62941489b9a81599cd61eee279c94fa9b))
- **tags:** sort tags alphabetically in each group, and add humppa, fusion and acid jazz ([`2d68aff`](../../commit/2d68aff27586e47878cb615b7bf572b4ce1a7d1d))
- **bpm:** ship reviewed tempo estimates with the catalogue, and let curators say there's none ([`b561e7a`](../../commit/b561e7a4814813a31cfdacf59f26855ef8cdf2cd))
- **icons:** add a Windows 11 mock-up, laid out after a real Start menu and desktop ([`e36d356`](../../commit/e36d356b7ee7f94aa874e4d99f044c44ba3dc496))
- **tags:** let curators set, change and remove a tune's bpm ([`0750b57`](../../commit/0750b57b63830a909b1e0a7d0ee28a9ed90b7c56))
- **tools:** mark bpm results ok, double or check, and add a review tool ([`3b6dbe7`](../../commit/3b6dbe773b0a01876dfd273bfd85f62e7af158dc))
- **tools:** add a batch BPM estimator for SID subtunes ([`8d8849a`](../../commit/8d8849aa9c47169016c38b58f8fd6b34737e4574))
- **sound:** pick the chip apart from per-chip 6581 and 8580 presets loaded from sid-presets.json ([`50b8519`](../../commit/50b85196de3b9de19645c40b93d08e400ce5057d))
- **icons:** render mock-ups of the icon on each platform with the icon build ([`a6659d8`](../../commit/a6659d8c6499e65989f8e99cd83c92fb7fee4a7a))
- **tags:** add more style and mood tags ([`450ea45`](../../commit/450ea4539da2d6cbe25b390107e05139fdd9fce0))
- **curation:** turn on sync when accepting a curator or admin invite, and say so ([`8ed5ad6`](../../commit/8ed5ad67ee83e34e4850b753b206b76d5190ae46))
- **curation:** let admins expire a waiting curator invite early ([`6431e41`](../../commit/6431e41147724632c00e2056d66a93f8b06aae40))
- **curation:** curation tab for curators and admins, with an on/off switch per curator ([`27df462`](../../commit/27df4628c67a85ebb21e79099456235d18895a1a))
- **icons:** build the app icons and favicon from a PNG source ([`8fe6a53`](../../commit/8fe6a53c0d8efc8fabd303fd31d85a2448d6aadb))
- **tags:** add prog, novelty, prank, noise, fake-music and melodic tags, merge filter tags ([`05e2f92`](../../commit/05e2f9284320b435b04c08605ec20b375098eff1))
- **tags:** curator-only tune tags from a fixed list, with invite links and admins ([`535bc71`](../../commit/535bc718ada9a5d200c9f1280c0977f50fbedbc6))
- **about:** show the git describe version on the about page ([`6d2d756`](../../commit/6d2d756049547094590ca9da347ed4f89324b6cf))
- **playlists:** ask before adding a tune twice, with a per-playlist opt-in for duplicates ([`89d18a4`](../../commit/89d18a47776e605b28e003924f8b2c05bd1bb9aa))
- **player:** add shuffle and repeat (queue or tune) to Now Playing ([`edfe99d`](../../commit/edfe99d8d471be7269c9f57b62bd27297946cbdf))

### fix

- **player:** keep iPhone audio resumable after pause ([`a93280a`](../../commit/a93280a2ab4cf1a5f62b5368df74dd0d98b7234a))
- **player:** restore iPhone system media controls ([`07c6926`](../../commit/07c692609bf56626f8ccaf6b97885c11a31d6457))
- **player:** avoid device restart with native audio sessions ([`cd1c92b`](../../commit/cd1c92b175ae8826193d661f4da3db0b1915dee1))
- prevent mobile double-tap zoom and fade pause audio ([`98dac08`](../../commit/98dac08f1e751e6326a2a88df4584679f3c6670a))
- disable double-tap zoom throughout app ([`6225008`](../../commit/6225008e66f6a45dd0bd6f8c0c9a69f5bfd92c60))
- **player:** fade to silence before pausing audio ([`ec159c6`](../../commit/ec159c6c9edb93923e0cf4fa82c5aa43fb1a4790))
- **playlists:** simplify merge review and shared imports ([`267c355`](../../commit/267c3556357f860a8a3808f1ce93854496b4fef3))
- hide modals until Ionic initializes ([`f36a525`](../../commit/f36a5256fe6d6476e5410b2788ae2a9cb11bcec6))
- simplify playlist import dialog wording ([`32ffd7a`](../../commit/32ffd7a6b4715996a014a9ba683ea9f3b89f5ccf))
- skip service worker registration on localhost ([`e3a9c73`](../../commit/e3a9c7377eaae04d970728fac9ba79ad10e071bd))
- wrap song badges onto multiple lines ([`b9605d2`](../../commit/b9605d2b23045d4049fee899eac9eb6de2fb8f83))
- remove success and status toasts ([`7ea8197`](../../commit/7ea819798e2ca1ab8c16ef7212c53f62b85d174b))
- **css:** add side margin to meta text and space below chip labels ([`04e09d4`](../../commit/04e09d4c51df0d9f8f8ac06ee048c2db29c66d3d))
- **sound:** hide reSIDfp-only settings for other engines ([`b12150a`](../../commit/b12150a075140d438b07f41e98ceaaa1ff8a5c8c))
- **now-playing:** keep the play button round when the controls row shrinks ([`e09a9a8`](../../commit/e09a9a873a276e43765ea823a080c234cdbcc27a))
- **icons:** pad the artwork so platform masks don't crop it, and add a mask close-up mock-up ([`02cbeb4`](../../commit/02cbeb46f081202690b953229d2bb4ebdb19b578))
- **bpm:** save results with paths within HVSC, and convert older absolute ones ([`2bd4189`](../../commit/2bd4189577830ee7f10d4c7b07c51bc5a3c3d364))
- **curation:** stop the curation tab label from repeating ([`e1946d2`](../../commit/e1946d21e48dadac4c854d3e33a83dc7d186317a))
- **tags:** list the tunes of matching tags when searching with #tag ([`b83e6c5`](../../commit/b83e6c560f2608122de042bff82335d9429034a7))
- **player:** end tunes at the silence before they loop back, and fade out the end ([`3f1a1d3`](../../commit/3f1a1d3a529858f298f919ae86e38ec6f577644e))
- **lists:** keep the playing row marked after a subtune switch, in an alternate colour ([`bb644be`](../../commit/bb644be0a746a75f65a33e5eadef8cb6d8ffd29f))

### docs

- **about:** reword the acknowledgements ([`cfe8e7e`](../../commit/cfe8e7e8ce1da4e57e5476397d9ed866803e2784))
- **about:** thank Sulevi, Tempest and Grue in a new Acknowledgements section ([`70f63d6`](../../commit/70f63d64ca79583acc0419ed5e9a15410c57239f))

### refactor

- **rules:** keep the tag ids only in tags-vocab.json and build firestore.rules from a template ([`71f1e1c`](../../commit/71f1e1c72edec9e02ecc42cd72fe237218e52116))

### style

- **theme:** consolidate the grays into seven tokens and tint Ionic's gray ramp to match ([`6b04104`](../../commit/6b0410465bac7796f8f4a00fe9066eb08a85425c))
- **home:** colour the playlist and mix cards' icons and gradients ([`7ed0b1d`](../../commit/7ed0b1d48e2c4f00f65b538423a9ed50bb4b7b44))
- **tags:** give tag chips the composer chip look ([`0c0d4cf`](../../commit/0c0d4cf12207639a27ea048d8d562adc11ed79c4))

### build

- **icons:** strip PNG metadata so rebuilds are byte-identical, and ignore the mock-ups ([`73c47f6`](../../commit/73c47f6ddb467732d3331650be7228d68b8b7257))
- **release:** add standalone release scripts with tag-based versioning ([`075f73e`](../../commit/075f73e8dc3714eccd0b7c6e5304f66e93b7f3e0))

### ci

- **admin:** run the admin data sync at 00:00 UTC ([`1641027`](../../commit/1641027c37938b26de08492e313e020d9610c2cd))
- **firebase:** deploy firestore.rules before pages, with the tag list built into the rules ([`623fcc8`](../../commit/623fcc80d566dccf9de3fbe2ba68e04d089c2a87))

### chore

- add mise tasks to start GitHub Actions workflows ([`53d02ff`](../../commit/53d02ffb19ef8bc16c7f47b05c18926741cb3ff7))
- **notices:** end the move notice and show it daily ([`fde1394`](../../commit/fde1394e9452f5a0d2ff65a0f6d7be691be44d5d))
- **bpm:** estimates for 50616 subtunes ([`d226ddf`](../../commit/d226ddf6a4354ad1bf1be4a638596cbbb0861e93))
- **site:** point everything at sid.extend.fi instead of the old address ([`ccefada`](../../commit/ccefada94f4fc148b594fa8f03708c81b9770be4))
- **bpm:** estimates for 28225 subtunes ([`ba51162`](../../commit/ba511620887e291f8df705b7a73696f914128d4b))
- **icons:** rebuild the icons from the new source image ([`101e659`](../../commit/101e6595447eb10d6b83c6136e3e28d14f8dbd5f))
- **bpm:** estimates for the first 7707 subtunes ([`b127fbb`](../../commit/b127fbb8aa3a78afe9ae1a2a799f4e984c0f1be8))
- **curation:** drop the note under the curator list ([`b9479d1`](../../commit/b9479d111bfaa1b3cfd744d19c9ecb17ac949687))
- **icons:** rebuild the icons from the updated source image ([`bc63ea3`](../../commit/bc63ea3c6a41722abc6bf68b86610bc79d5559e3))

### other

- Review playlist re-imports and prevent duplicate playlist names ([`c678e4c`](../../commit/c678e4c656125e955395080ad746eecc73905d22))
- Show Allow duplicates as a toggle in playlist menus ([`76bad98`](../../commit/76bad98c25774751be3838c4ee16f667b25aac68))
- Keep playlist reorder handles available without edit mode ([`19b45fd`](../../commit/19b45fd05100114687f6f3269f334973494abb83))
- Document UI rules and reserve toasts for errors ([`fd28278`](../../commit/fd28278f0290a47ff44963aa341baa4b112b4a33))
- Ignore SID display metadata when matching ZIP imports ([`e1ddc49`](../../commit/e1ddc49abd9a329d54d3085fc6fb5d40e440477e))
- Import ZIP playlists by SID hash and allow subtune selection ([`ca27cf3`](../../commit/ca27cf309443d342a30f06f29bff84c684601266))
- Publish admin changes (#11) ([`fb8d85d`](../../commit/fb8d85d7556ab2c5cef268d583a243c8d431f850))
- Publish admin changes (#10) ([`8216f17`](../../commit/8216f174ba796c02894b6dc88ee041f0deb980f2))
- Add approved tag definitions (#8) ([`598092b`](../../commit/598092b7a699afdec4ee199470a384283839823d))
- Add approved tag definitions (#7) ([`5905a88`](../../commit/5905a88b06a00907d8044a5dcff1b8e1c70ffd99))
- Add local C64 ROM settings and update libsidplayfp-wasm ([`e709095`](../../commit/e7090958863c5e791ce819a9d9338df9b2b3cc05))
- Move sound and cloud sync into Settings pages ([`4a1db7d`](../../commit/4a1db7df83e36edc685d5b842e4142e253f7c83a))
- Fix resuming playback from macOS media controls ([`ba8437b`](../../commit/ba8437ba01cf4c36c7c4d69ab08b5cc97dd71afc))
- Ignore browser shortcuts in player keyboard controls ([`7295ab8`](../../commit/7295ab8817133cd96b4eabe0836dd0addcc2b97e))
- Show friendly recovery message for playback memory errors ([`0be9fb8`](../../commit/0be9fb845d505c30953f67d8f71136b0e0b6d2c2))
- Add approved tag definitions (#6) ([`ddb33dc`](../../commit/ddb33dc07d2289db679543a4e1e1f480589c911a))
- Add admin tag definitions and nightly vocabulary publishing ([`0bf47aa`](../../commit/0bf47aa20f5ac58f6eeb7cf3ed28d39f385691b8))
- Add Dubstep style tag ([`ecfba76`](../../commit/ecfba768c00642c092cb3575711335581cc22671))
- Add local usage report, BPM setup script and top 1000 playlist ([`3146887`](../../commit/314688735fa08bf1cc9da3e8e29d4afeaaeee53e))
- Redirect HVSC browser visits to the app ([`a1c319f`](../../commit/a1c319fdac1a82ada4e51682d3019dfbc21e4bf8))
- Use default Firebase Hosting site for HVSC ([`489e730`](../../commit/489e730587a9ed4d574501723defe265f85eda22))
- Fix Sound button by separating visibility from open method ([`a59cc3a`](../../commit/a59cc3a2204781bf9a01625932533ecceaaddd31))
- Move CI Python into committed HVSC scripts ([`005a2aa`](../../commit/005a2aae8c9f09c6cb1b3f3b31bf32c169d74ce5))
- Check HVSC updates after its twice-yearly releases ([`0224f98`](../../commit/0224f98ceb6368e2dba46d4416b70b3eb4b557c9))
- Host HVSC SIDs on Firebase with automated updates ([`bbabaae`](../../commit/bbabaae2b6115f938dffb71dd5c26666fef641d4))
- Update icon ([`4262a0a`](../../commit/4262a0ad659a3a62bde374c51e020b7b21ac0ac3))
