# Energy Fight: žanro eksperto analizė (2026-10-05)

Žaidimą vertinau kaip kooperatinio veiksmo („brawler“ ir „looter“) žanro žaidimą telefone: kas laiko žaidėją, kas teikia malonumą, kur jis nusivils.

## Kas pataisyta šiame etape

| # | Spraga | Kas padaryta |
| --- | --- | --- |
| 1 | **Nebuvo priežasties žaisti dar kartą.** Lygiai auga, bet nėra „noriu dar vieno bandymo“ jausmo. | **Boso dėžių sistema.** Nukovus bosą kiekvienam aktyviam žaidėjui iškrenta jo paties mineralų dėžė: bronzinė, sidabrinė, auksinė, PLATININĖ, DIEVIŠKOJI ir ULTRA MEGA. Kuo didesnis įnašas (pagal tavo lygį), tuo geresnė dėžė. Tikimybės esant vidutiniam įnašui: platininė ≈1/100, dieviškoji ≈1/1000, ULTRA ≈1/10 000 (patikrinta 2 mln. traukimų testu). |
| 2 | Silpnesnis žaidėjas niekada nebūtų „žvaigždė“. | Įnašas dalinamas iš žaidėjo lygio galios. Jaunesnis brolis, kuris gerai žaidžia 3 lygyje, gali gauti geresnę dėžę nei 18 lygio veteranas. Kontrolė, tikslo saugojimas ir pakėlimai irgi skaičiuojami, ne tik žala. |
| 3 | Nebuvo ekipuotės ir personažo kūrimo gylio. | **36 daiktų tipai** (ginklas, skydas, šalmas, šarvai, aura, relikvija), **6 retumai**, 7 savybės ir **8 specialūs efektai**: gyvybės siurbimas, spygliai, pulsas, feniksas, išsisukimo skydas, pirmas smūgis, perkrova ir sargas. Yra ir 6 unikalūs ULTRA daiktai. Savybių sumos turi viršutines ribas, kad ekipuotė nesugadintų balanso. |
| 4 | Stiprus žaidėjas neturėjo būdo padėti, išskyrus daryti žalą. | Specialus efektas **„Sargas“**: šalia esantys draugai gauna 10% mažiau žalos. Tai daiktas, skirtas „vyresniojo brolio“ vaidmeniui. |
| 5 | Retas laimikis nesukeldavo emocijos. | Dėžė kovoje nukrenta ant žemės su atšokimu. Aukštesnio lygio dėžės skleidžia sukamus spindulius, kibirkštis ir mirga, ULTRA keičia spalvas. Pasirodo „WOW!!!“ užrašas, skamba fanfaros, ekranas blyksteli. Atidarymo scena: dėžė dreba ir sprogsta, daiktai išskrenda kortelėmis. |
| 6 | Kritinių smūgių nesimatė. | Kritinis smūgis rodomas didesniu, geltonu skaičiumi su „!“. |
| 7 | Ekipuotės nesimatė kovoje. | Uždėta aura rodoma kaip besisukantis žiedas po veikėju, retumo spalva. |
| 8 | Inventorius galėjo augti be ribos. | Riba 150 daiktų. Viršijus ją, silpniausi nedėvimi daiktai automatiškai išardomi į laužą. |
| 9 | Dėžės ar daiktai galėjo būti dubliuoti. | Dėžė serveryje išduodama vieną kartą (raktas: misija + profilis). Daiktai saugomi duomenų bazėje. Klientas nieko nesprendžia. |

## Antras taisymų etapas

| Spraga | Kas padaryta |
| --- | --- |
| Misija per trumpa ir monotoniška | **Elitiniai priešai** su karūna ir keturiomis savybėmis: šarvuotas, greitas, sprogus (po mirties sprogsta) ir atsinaujinantis. Jie stipresni, bet visada palieka gydančią ląstelę. Pridėta 6-a banga, gynybos dalis ilgesnė. Robotų misija dabar trunka 4–7,5 min. (anksčiau 3–5), visos linijos laimi net vienos. |
| Nebuvo kur išleisti laužo | **Daiktų tobulinimas** +1…+5 (kiekvienas lygis +6% visoms savybėms) ir **perkalimas**: antrinės savybės perridenamos, pagrindinė lieka. |
| Naujokui nebuvo paaiškinimų | **Patarimai pirmose misijose**: judėjimas, smūgiai, raudonos zonos, išsisukimas, įgūdžiai, draugo pakėlimas, ląstelės, stabilizatorius, bosas, elitiniai priešai, perkrova. Kiekvienas rodomas vieną kartą; 7+ lygio žaidėjams nerodomi. |
| Laukiamajame nesimatė komandos jėgos | Prie kiekvieno žaidėjo rodoma **ekipuotės galia**. |
| Animacijos | Paruoštas **animacijų grojimas**: ChatGPT kadrų juostas įdėjus į `client/public/assets/animations/`, veikėjai ir priešai jas groja automatiškai pagal veiksmą. Patikrinta su bandomosiomis juostomis. |

## Trečias taisymų etapas

| Spraga | Kas padaryta |
| --- | --- |
| Nebuvo priežasties grįžti kasdien | **Dienos iššūkis.** Lyderis laukiamajame jį įjungia. Kasdien keičiasi taisyklė: „Elitų diena“ (≈30% priešų elitiniai), „Pasiutimas“ (priešai 20% greitesni) arba „Stiklo patranka“ (visi muša ir gauna 30% stipriau). Pirma tos dienos pergalė kiekvienam žaidėjui duoda **bent auksinę dėžę** ir +40 laužo. Serveris tai įrašo į duomenų bazę: viena dienos dovana vienam profiliui. Laukiamajame ☀ ženklas rodo, kas šiandien dar gali ją gauti. |
| Antras bosas kovojo tame pačiame kambaryje | Valdovo misijoje boso arena virsta **kristalų šerdimi**: tamsios violetinės grindys, runų žiedas, kristalai ant sienų, plaukiojančios kibirkštys. Plyšiai specialiai blankūs, kad nebūtų painiojami su lazeriais. |
| Telefonų našumas | **Automatinė kokybė.** Jei kadrų dažnis 5 s laikosi žemiau 40, žaidimas pirmiausia išjungia papildomus efektus, o paskui piešia 1× raiška. Apie tai pranešama. |
| Animacijos rodė ne viską | Įgūdžiai, sužeidimas, prisikėlimas ir perkrova dabar rodo savo kadrus, taip pat ir kitų žaidėjų. Animacijos trukmė imama iš juostos. Dydis matuojamas pagal tikrą piešinį, todėl Pyra nebėra per maža. |

## Ketvirtas taisymų etapas (žaidėjo pastabos)

| Pastaba | Kas padaryta |
| --- | --- |
| Virš žaidėjo turi matytis gyvybės | Juosta virš **kiekvieno** žaidėjo galvos, ir virš tavęs. Spalva kinta nuo žalios per geltoną iki raudonos. Balta dalis rodo ką tik prarastas gyvybes. Žydra linija – skydas. Kai lieka mažai gyvybių, juosta mirksi. |
| Neaiški mirties emocija | **Parkritus** pasaulis pasidaro pilkas, kraštai pulsuoja raudonai, ekranas blyksteli ir sudreba. Rodomas didelis užrašas „Parkritai“ ir atgalinis laikmatis; kai draugas kelia, langas pažaliuoja. **Žuvus visai komandai** viskas sulėtėja ir užtemsta, per visą ekraną nusileidžia užrašas „MISIJA ŽLUGO“. Rezultatai rodomi tik po jo. Laimėjus – auksinis „MISIJA ĮVYKDYTA“. |
| Neaišku, ką reiškia skaičiai | Visi skaičiai turi pavadinimus („Laužas“, „Gyvybės“, „Žala“, „Ekipuotės galia“). Niekam nenaudojami fragmentai pakeisti ekipuotės galia. Mygtukas **„?“** paaiškina kiekvieną rodiklį paprastais žodžiais. |
| Kalba | **Anglų kalba numatytoji**, lietuvių pasirenkama mygtukais EN/LT laboratorijoje ir nustatymuose. Testas tikrina, kad kiekvienas tekstas turi abu vertimus. |
| Kovos jausmas lėkštas, bėgiojant viską galima išvengti | **KOMBO**: kiekvienas pataikęs smūgis kelia skaitiklį, kiekviena pakopa +2% žalos (iki +40%). Nemušus 2 s kombo dingsta, o stipriai gavus – sumažėja perpus. Kas 10 smūgių – pranešimas. **Smūgio svoris**: priešas atšoka ir susispaudžia, trumpam sustoja kadrai, stiprūs ir kritiniai smūgiai sudrebina ekraną. **Bėgiojimas baudžiamas**: persekiotojai iš vidutinio atstumo šoka į tave (raudona juosta įspėja ~0,4 s prieš šuolį; galima išsisukti). Persekiotojai greitesni (105→125). **Bosai lengvesni**: Motininė masė 3000→2600 gyvybių, Valdovas 2200→1900. |

## Penktas etapas: perdarymas pagal BOTS!! jausmą (B variantas)

| Kas | Kaip veikia dabar |
| --- | --- |
| **„SECTOR CLEAR!!“ ir dėžės** | Bosui žuvus sulėtėja laikas, per ekraną nusileidžia komiksinis užrašas su spindulių pliūpsniu. Iš boso kiekvienam žaidėjui aukštu lanku iššaunama jo dėžė (ChatGPT piešiniai: sukasi, palieka žvaigždučių uodegą, nusileidžia su blyksniu ir atšoka). |
| **Valdymas** | Z/didelis mygtukas – vienas paspaudimas, vienas smūgis (ritmu – kombinacija; laikant – lėtai). C/rodyklė – šuolis su tikru aukščiu; ore Z – smūgis į žemę. X/skydas – gynyba (−80% žalos iš priekio; tiksliai laiku – ATRĖMIMAS, priešas apsvaigsta; išsekus – gynyba lūžta). Bėgimas – dvigubas krypties paspaudimas arba vairalazdės palietimas iš naujo. Šuolis išgelbsti nuo žemės atakų. |
| **Pabudimas** | Nuo 1 lygio. Juosta pildosi kovojant. V/žaibo mygtukas – 15 s titano forma: herojus 1,6× didesnis, ×2 žala, perpus mažiau gaunamos žalos, didesnis siekis, užrašas „AWAKENED!!“. |
| **Sektoriai 1–20** | Vietoj vienos ilgos misijos. Kiekvienas – 3 kambariai, laikmatis, likusių priešų skaičius, „GO!“ rodyklė. Bosas kas 4-ą sektorių (Motininė masė arba Kristalų Valdovas). 8 ir 18 – elitiniai, ×2 XP ir laužo. Temos: Nexus, lava, kristalai, avilys, dangus. Atrakinama įveikus ankstesnį. Kamera artėja koridoriuose, tolsta boso kovoje. |
| **Nauji priešai** | Plakikas (greitas), Ritulys (rieda linija – peršok), Bombonešis (bombos lanku), Skydininkas (blokuoja iš priekio – apeik arba trenk iš viršaus). Vardai virš galvų, mirdami sprogsta į gabalus, išbarsto **monetas** (kiekviena +1 laužo). |
| **Tituliai** | Rezultatuose ★ MVP (daugiausia nukauta) ir ☠ Bosų žudikas (daugiausia žalos bosui). |

## Didžiausios likusios spragos (pagal svarbą)

1. **Animacijų piešiniai.** Pyra, Vektor ir Krios (visos formos, po 12 animacijų) jau animuoti tikrais kadrais. Vektor sklando ant žydros energijos auros. Liko Litos, priešai ir Valdovas.
2. **Misijos tempas.** Pailginta, bet reikia gyvo žaidimo testo, ar tempas jaučiasi gerai.
3. **Turinys.** Pridėtas antras bosas **Kristalų Valdovas** (misija „Kristalų šerdis“): piliarų skydas, besisukantys lazeriai, šukių novos ir teleportacija. Dienos iššūkis ir kristalų arena jau padaryti. Liko tikri Valdovo piešiniai ir daugiau misijų.
4. **Garsas.** Garsai kol kas sintetiniai. Reikia tikrų smūgių, dėžių atidarymo garsų ir muzikos.
5. **Telefonų našumas.** Automatinė kokybė jau veikia, bet tikruose telefonuose kadrų dažnis dar nematuotas.
