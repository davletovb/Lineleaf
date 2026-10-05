// Synthetic copies of the composer layouts that real chat and social sites use: the editable is only one part of the box, and
// controls sit next to it. Every element a badge must not cover carries `data-control`; the box the user sees as the input carries
// `data-box` (a layout without one, like the borderless social composer, has the editable itself as its input). The markup is invented for this test
// (no site code or text is copied); only the arrangement is imitated.
const BASE = `<style>
  body { margin: 0; font: 15px system-ui; background: #f3fbfa; }
  button { font: inherit; border: 1px solid #d5dad9; background: #f2f3f3; border-radius: 10px; height: 34px; min-width: 34px; padding: 0 10px; }
  button.round { border-radius: 50%; width: 34px; padding: 0; }
  #field { display: block; width: auto; min-height: 0; margin: 0; border: 0; outline: 0; background: transparent; font: 18px system-ui; resize: none; } /* undo the host page's own field rules */
  .row { display: flex; align-items: center; gap: 8px; }
  .grow { flex: 1; }
</style>`;

export const LAYOUTS = {
  // A card with the field on top and a toolbar row inside the same bordered box.
  card: `${BASE}
    <div data-box style="margin: 40px; width: 640px; box-sizing: border-box; border: 1px solid #cfe0dd; border-radius: 16px; background: #fff; padding: 16px">
      <textarea id="field" rows="2" style="width: 100%; height: 56px">He go to work.</textarea>
      <div class="row" style="margin-top: 12px">
        <button data-control>+</button><button data-control>Tune</button><button data-control>Model name v</button>
        <span class="grow"></span><button data-control>Credits</button><button data-control class="round">Up</button>
      </div>
    </div>`,
  // No border or fill around the field; its toolbar and a Post button sit right under the text.
  social: `${BASE}
    <div style="margin: 40px; width: 560px; padding: 12px">
      <button data-control style="border-radius: 16px; height: 26px">Everyone v</button>
      <div id="field" contenteditable="true" style="margin: 16px 0 0; min-height: 70px; font-size: 20px">He go to work.</div>
      <div class="row">
        <button data-control>Img</button><button data-control>Gif</button><button data-control>Poll</button><button data-control>Smile</button>
        <span class="grow"></span><button data-control style="border-radius: 18px; background: #aab; height: 36px">Post</button>
      </div>
    </div>`,
  // A pill whose editable sits between controls, with a disclaimer under it.
  pill: `${BASE}
    <div style="padding: 90px 60px 30px">
      <div data-box class="row" style="box-sizing: border-box; width: 760px; margin: 0 auto; padding: 14px 20px; border-radius: 40px; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.18)">
        <button data-control style="border: 0">+</button>
        <div id="field" contenteditable="true" class="grow" style="font-size: 17px; min-height: 24px; outline: 0">He go to work.</div>
        <button data-control style="border: 0">Flash Extended v</button><button data-control style="border: 0">Mic</button>
      </div>
      <p data-control style="width: 760px; margin: 14px auto 0; text-align: center; font-size: 12px; color: #666">An assistant can make mistakes, so double-check replies.</p>
    </div>`,
  // A bordered box with the toolbar outside and below it, chips and a picture above it.
  dock: `${BASE}
    <div style="margin: 60px 30px 0; width: 800px">
      <div class="row" style="margin-bottom: 8px">
        <button data-control>Default</button><button data-control>project</button><button data-control>main</button><button data-control>+</button>
        <span class="grow"></span><svg data-control width="64" height="44" viewBox="0 0 64 44"><rect width="64" height="44" fill="#c97b5b"/></svg>
      </div>
      <div data-box class="row" style="box-sizing: border-box; border: 1px solid #c9c9c4; border-radius: 16px; background: #fff; padding: 14px 18px; height: 84px; align-items: flex-start">
        <textarea id="field" rows="2" class="grow" style="height: 52px">He go to work.</textarea>
        <button data-control style="border: 0; background: none">Enter</button>
      </div>
      <div class="row" style="margin-top: 10px">
        <button data-control style="border: 0">+</button><button data-control style="border: 0">Mic</button><button data-control style="border: 0">Auto</button>
        <span class="grow"></span><span data-control>Model 5.5</span><span data-control>Effort</span><button data-control class="round">Go</button>
      </div>
    </div>`,
};
