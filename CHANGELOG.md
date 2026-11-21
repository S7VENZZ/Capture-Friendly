# Changelog

## 1.0.0 (Beta)

**English** (Deutsche Fassung weiter unten / German version below)

First public version of **Capture Friendly**: the picture and sound of your capture card in a window you share in Discord, no OBS needed. This is a **beta** and only the beginning of the program: more will follow, and errors can still occur. If you notice something, please report it (see "Good to know").

### What it can do

- **Plug & play:** The card is found, read and switched on by itself when the program starts and when you plug it in. Webcams and virtual cameras are never switched on by themselves. A card you switched off by hand stays off until you plug it in again.
- **Picture modes at a glance:** 4K, 1440p, 1080p, 720p and 480p as a list, each with the highest frame rate the card offers, **also above 60 FPS** (for example 120, 144 or 240) if the card can do it. Frame rates are only offered up to what the card can do at the chosen size. The statistics show how many pictures really arrive. A card is read once and then remembered; another card is read afresh; "Detect again" reads again when needed. Default: automatic size at 1080p and 60 FPS; a custom size is possible.
- **Clean sound:** only the sound of the card (48 kHz), never the microphone or PC sound. The sound input at the bottom is the card by itself (only the sound inputs of capture cards are offered), and the program plays the sound once on your Windows default device, so nothing has to be switched on in Windows. Gain from −12 to +24 dB with a limiter against distortion. If you already hear the game on the TV, choose another output in the settings (a device you do not listen to); Discord still gets the sound.
- **Help if there is no sound:** if only silence arrives from the card (or Windows blocks the sound input, or Windows plays the sound of the card as well with "Listen to this device"), the top bar of the window says so and what to check. In the settings under Sound there is a short list "No sound?". The program only reads that Windows setting and never changes it.
- **Always a rich picture:** cards often deliver "limited" video (black looks grey). Capture Friendly always corrects that, so the colours stay the same from one scene to the next. Plus brightness, contrast, hue, saturation and mirroring.
- **Nine languages:** English (default), German, Spanish, French, Portuguese (Brazil), Russian, Chinese (Simplified), Japanese and Turkish. The choice is at the very top of the settings and applies at once. The translations were made with AI and have not been checked by native speakers yet.
- **No signal & auto-reconnect:** a clear message when no picture arrives; the card is opened again, and after it was unplugged the program switches itself on again.
- **Private mode** (key **B**): picture black and sound silent at once. **Fullscreen** (key F, F11 or double click). **Statistics** (key I, off by default; warnings always appear).
- **Show in Discord (optional, off by default):** your friends see "Capture Friendly" with the logo, a timer and a button to get the program, while the picture runs. Nothing has to be linked; Discord only has to run on your PC. Only a fixed text is sent, never picture, sound, card name or device. Discord does not show you your own button, only other people.
- **Updates itself:** Settings → Info → Check. If there is a new version, click Update. The installer comes from GitHub only; its size and SHA-256 are checked before it is started.
- **Privacy:** no accounts, no statistics sent, no picture or sound sent anywhere. The page inside the program has no network access.

### Good to know

- Tested with a **UGREEN** capture card. Other cards: not tested, no guarantee (the program uses the standard Windows video driver, so cards that report themselves as a camera or "USB Video" should work).
- Windows 10 and 11. The installer is not signed, so Windows may warn ("Windows protected your PC"): **More info → Run anyway**.
- Written with the help of an AI; the idea, the concept, the testing on real hardware and the publishing are by [S7VENZZ](https://github.com/S7VENZZ). Free and open source (MIT), no warranty.
- Problems and wishes: [open an issue](https://github.com/S7VENZZ/capture-friendly/issues/new/choose).

### Deutsch

Erste öffentliche Version von **Capture Friendly**: Bild und Ton deiner Capture-Karte in einem Fenster, das du in Discord teilst, ohne OBS. Das ist eine **Beta** und erst der Anfang des Programms: es kommt noch mehr, und es können noch Fehler auftreten. Wenn dir etwas auffällt, melde es bitte (siehe „Gut zu wissen“).

#### Das kann das Programm

- **Plug & Play:** Die Karte wird beim Start und beim Anstecken von selbst gefunden, ausgelesen und eingeschaltet. Webcams und virtuelle Kameras werden nie von selbst eingeschaltet. Von Hand ausgeschaltet bleibt es aus, bis die Karte neu angesteckt wird.
- **Bildmodi auf einen Blick:** 4K, 1440p, 1080p, 720p und 480p als Liste, jeweils mit der höchsten Bildrate, die die Karte kann, **auch über 60 FPS** (zum Beispiel 120, 144 oder 240), wenn die Karte es schafft. Bildraten werden nur bis zu dem angeboten, was die Karte bei der gewählten Größe kann. Die Statistik zeigt, wie viele Bilder wirklich ankommen. Eine Karte wird einmal ausgelesen und dann gemerkt; eine andere Karte wird neu ausgelesen; „Neu erkennen“ liest bei Bedarf erneut. Standard: automatische Größe mit 1080p und 60 FPS; eine eigene Größe ist möglich.
- **Sauberer Ton:** nur der Ton der Karte (48 kHz), nie Mikrofon oder PC-Ton. Der Ton-Eingang unten ist von selbst die Karte (angeboten werden nur die Ton-Eingänge von Capture-Karten), und das Programm spielt den Ton einmal auf deinem Windows-Standardgerät ab, in Windows muss nichts eingeschaltet werden. Verstärkung von −12 bis +24 dB mit Begrenzer gegen Übersteuern. Hörst du das Spiel schon am Fernseher, wählst du in den Einstellungen eine andere Ausgabe (ein Gerät, das du nicht hörst); Discord bekommt den Ton trotzdem.
- **Hilfe bei „Kein Ton“:** Kommt nur Stille von der Karte (oder Windows sperrt den Ton-Eingang, oder Windows spielt den Ton der Karte mit „Abhören“ zusätzlich ab), sagt das die obere Leiste im Fenster und was du prüfen kannst. In den Einstellungen unter Ton steht eine kurze Liste „Kein Ton?“. Das Programm liest diese Windows-Einstellung nur und ändert sie nie.
- **Immer ein sattes Bild:** Karten liefern das Bild oft „begrenzt“ (Schwarz wirkt grau). Capture Friendly korrigiert das immer, damit die Farben von einer Szene zur nächsten gleich bleiben. Dazu Helligkeit, Kontrast, Farbton, Sättigung und Spiegeln.
- **Neun Sprachen:** Englisch (Standard), Deutsch, Spanisch, Französisch, Portugiesisch (Brasilien), Russisch, Chinesisch (vereinfacht), Japanisch und Türkisch. Die Auswahl steht ganz oben in den Einstellungen und gilt sofort. Die Übersetzungen wurden mit KI erstellt und noch nicht von Muttersprachlern geprüft.
- **Kein Signal & Auto-Reconnect:** klare Meldung, wenn kein Bild ankommt; die Karte wird neu geöffnet, und nach dem Abstecken schaltet sich das Programm wieder ein.
- **Private-Modus** (Taste **B**): Bild sofort schwarz, Ton still. **Vollbild** (Taste F, F11 oder Doppelklick). **Statistik** (Taste I, standardmäßig aus; Warnungen erscheinen immer).
- **Anzeige in Discord (optional, standardmäßig aus):** deine Freunde sehen „Capture Friendly“ mit Logo, Laufzeit und einem Knopf zum Laden, solange das Bild läuft. Nichts muss verknüpft werden; Discord muss nur auf deinem PC laufen. Gesendet wird nur ein fester Text, nie Bild, Ton, Kartenname oder Gerät. Discord zeigt dir deinen eigenen Knopf nicht, nur den anderen.
- **Aktualisiert sich selbst:** Einstellungen → Info → Prüfen. Gibt es eine neue Version, klickst du auf Aktualisieren. Der Installer kommt nur von GitHub; Größe und SHA-256 werden vor dem Start geprüft.
- **Datenschutz:** keine Konten, keine Statistik-Übertragung, keine Übertragung von Bild oder Ton. Die Seite im Programm hat keinen Netzwerkzugang.

#### Gut zu wissen

- Getestet mit einer **UGREEN**-Capture-Card. Andere Karten: nicht getestet, keine Garantie (das Programm nutzt den Standard-Videotreiber von Windows, Karten, die sich als Kamera oder „USB Video“ melden, sollten laufen).
- Windows 10 und 11. Der Installer ist nicht signiert, deshalb warnt Windows eventuell („Der Computer wurde durch Windows geschützt“): **Weitere Informationen → Trotzdem ausführen**.
- Mit Hilfe einer KI programmiert; die Idee, das Konzept, das Testen an echter Hardware und die Veröffentlichung stammen von [S7VENZZ](https://github.com/S7VENZZ). Kostenlos und Open Source (MIT), keine Gewähr.
- Probleme und Wünsche: [Issue öffnen](https://github.com/S7VENZZ/capture-friendly/issues/new/choose).
