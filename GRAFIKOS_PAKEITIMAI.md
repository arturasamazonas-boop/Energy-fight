# Energy Fight – grafikos atnaujinimas

Šiame pakete yra visas atnaujintas žaidimo projektas ir **23 originalūs PNG piešiniai**, jau prijungti prie žaidimo kodo. Darbas paruoštas pagal `arturasamazonas-boop/Energy-fight` pagrindinės šakos versiją `2a383c1fa483a636c13819f38fbe7ec1c1d80bf3`.

## Nuo ko pradėti

1. Išskleisk ZIP archyvą.
2. Atidaryk **PIESINIU_GALERIJA.html** – visus piešinius galėsi apžiūrėti be serverio ar papildomų programų diegimo.
3. Žaidimui paleisti atidaryk projekto aplanką su Claude arba terminale ir vykdyk toliau pateiktas komandas. Reikia Node.js 22.12 arba naujesnės suderinamos versijos.

```bash
npm ci --include=dev
node -e "require('fs').mkdirSync('.data', { recursive: true })"
npm run dev
```

Kompiuteryje atidaryk **http://localhost:5173**. Telefone, prijungtame prie to paties Wi-Fi, naudok kompiuterio vietinį IP adresą su prievadu `5173`, pavyzdžiui, `http://192.168.1.23:5173`. Detalesnės paleidimo ir serverio instrukcijos yra README.md ir DEPLOY.md.

Tai telefonų naršyklėms skirtas žaidimo projektas. ZIP nėra APK ar iPhone diegimo failas. Į paketą įtraukti šaltiniai, priklausomybių versijų failas ir visi žaidimo piešiniai; priklausomybės įdiegiamos su `npm ci`.

## Kas sukurta

| Dalis | Turinys |
| --- | --- |
| Keturios pradinės rasės | Maži kompaktiški ugnies, ledo, vėjo ir žemės būtybių siluetai. |
| Aštuonios evoliucijos | Kiekvienai rasei po dvi atskiras brandžias formas. |
| Penki priešai | Persekiotojas, šaudantis priešas, šarvuotas priešas, pagalbininkas ir bosas. |
| Trys aplinkos vaizdai | Laboratorijos / kambario panorama, kovos fonas ir grindų tekstūra. |
| Trys objektai | Stabilizatorius, vartai ir gydymo biocelė. |
| Sąsaja | Pradinis ekranas, laboratorija, evoliucijų palyginimas, kambarys, kovos HUD ir valdikliai, rezultatai bei nustatymai. |
| Kovos vaizdavimas | Augimas pagal lygį, šešėliai ir atrama ties pėdomis, elementiniai smūgiai, skeveldros, ugnis, sūkuriai, bangos ir išsisukimo pėdsakai. |

Visi PNG yra **client/public/assets/illustrated/**. Tikslius jų vardus, paskirtį ir tolesnio piešinių kūrimo gaires rasi **ASSET_MANIFEST.json** ir **ART_GUIDE.md**.

## Dizaino ir įgyvendinimo sprendimai

Bendra kryptis – iliustruota biologinė mokslinė fantastika: gyvos būtybės, mineraliniai šarvai, šilta biokeraminė stotis, prislopinta žalsva erdvė ir saikingi auksiniai energijos akcentai. Rasių skirtumus rodo kūno forma, medžiagos ir energija. Pradinis veikėjas kompaktiškas; kylant lygiui jo vaizduojamas dydis didėja, o pasirinkta evoliucija pakeičia jo anatomijos piešinį.

Judėjimo ir kovos taisyklės remiasi esama serverio simuliacija. Grindys komponuojamos pagal tikras žemėlapio judėjimo zonas, o tolimas fonas naudojamas aplinkai. Vaizdų atrama nustatoma pagal jų alfa kanalą, todėl skirtingos formos gali teisingai stovėti ant žemės.

Kiekvienas veikėjo ir priešo PNG yra **vienos pozos iliustracija**. Kvėpavimą, pasvirimą, judesį, smūgio postūmį ir efektus sukuria žaidimo kodas. Atskirai pieštų bėgimo ar smūgio kadrų bei 3D modelių šiame pakete nėra. PNG originalai išsaugoti nepakeisti; nedideles tekstūras vaizdavimui sukuria pats žaidimas.

Kovoje įkeliamos esamos komandos veikėjų formos ir reikalingi priešai bei aplinka. Veikėjų PNG normalizuojami prieš GPU įkėlimą; efektų kiekis ribojamas. Tai sumažina nereikalingą vaizdų atminties naudojimą, tačiau realių telefonų FPS dar neišmatuotas.

## Patikros rezultatai

| Patikra | Rezultatas |
| --- | --- |
| TypeScript | Praėjo. |
| Žaidimo konfigūracija | Praėjo. |
| Produkcinis surinkimas | Praėjo; pakartotas po paskutinių sąsajos pataisų. |
| Automatiniai testai | **53 / 53**, be klaidų ir praleistų testų. |
| Piešinių inventorius | **23 / 23** PNG: formatas, permatomumas, paraštės ir susiejimas su kodu. |
| Piešinių validatoriaus testai | **6 / 6**; jie įtraukti į bendrą 53 testų skaičių. |
| Surinkto kliento ir tikro PGlite serverio HTTP patikra | **12 / 12**. |

Automatiniai testai apima aštuonių atskirų klientų misiją, prisijungimą iš naujo, progreso išsaugojimą ir atlygio taisykles. Šios patikros nepakeičia žmogaus žaidimo telefone.

**Vaizdinės patikros riba:** darbo aplinkoje Chromium ir headless shell užsidarė su `SIGTRAP` dar prieš atverdami aplikaciją. Todėl galutinio žaidimo išdėstymo ar kovos įskaitomumo nevadiname patikrintu naršyklėje. Galerijoje yra tikrieji žaidimo piešiniai; ji nėra žaidimo ekrano nuotrauka. Pirmiausia telefone reikėtų patikrinti veikėjų mastelį ir pėdas, aštuonių žaidėjų sceną, gebėjimų mygtukus ir nustatymų slinkimą.

Istoriniai ankstesnės prototipo versijos naršyklės bandymai atskirti faile IMPLEMENTATION_STATUS.md.

## Perdavimas Claude

Atidaryk šį projektą kaip atskirą darbo kopiją. Jei Claude tuo metu jau pakeitė pagrindinį projektą, palygink pakeitimus su nurodyta pradine Git versija ir sujunk juos per atskirą šaką. Visas grafikos įgyvendinimas yra `client/`, vaizdų inventoriuje, validavimo scenarijuje, vaizdų testuose ir dokumentacijoje.

Tolimesniems piešiniams naudok ART_GUIDE.md sutartį: tie patys failų vardai, tikras skaidrus fonas veikėjams ir objektams, viena aiški poza, visa anatomija su paraštėmis, jokių įpieštų tekstų ar grindų šešėlių.
