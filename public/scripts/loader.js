import { POPUP_RESULT, POPUP_TYPE, Popup } from './popup.js';

const ELEMENT_ID = 'loader';

/** @type {Popup} */
let loaderPopup;

let preloaderYoinked = false;

export function showLoader() {
    // Two loaders don't make sense. Don't await, we can overlay the old loader while it closes
    if (loaderPopup) loaderPopup.complete(POPUP_RESULT.CANCELLED);

    loaderPopup = new Popup(`
        <div id="loader">
            <div id="load-spinner" class="fa-solid fa-gear fa-spin fa-3x"></div>
        </div>`, POPUP_TYPE.DISPLAY, null, { transparent: true, animation: 'fast' });

    // No close button, loaders are not closable
    loaderPopup.closeButton.style.display = 'none';

    loaderPopup.show();
}

export async function hideLoader() {
    // Yoink preloader entirely; it only exists to cover up unstyled content while loading JS
    // If it's present, we remove it once and then it's gone.
    yoinkPreloader();

    if (!loaderPopup) {
        console.warn('There is no loader showing to hide');
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        //Sets up a 2-step animation. Spinner blurs/fades out, and then the loader shadow does the same  (by utilizing the popup closing transition)
        $('#load-spinner').on('transitionend webkitTransitionEnd oTransitionEnd MSTransitionEnd', function () {
            $(`#${ELEMENT_ID}`).remove();
            loaderPopup.complete(POPUP_RESULT.AFFIRMATIVE).then(() => {
                loaderPopup = null;
                resolve();
            });
        });

        $('#load-spinner')
            .css({
                'filter': 'blur(15px)',
                'opacity': '0',
            });
    });
}

function yoinkPreloader() {
    if (preloaderYoinked) return;
    document.getElementById('preloader').remove();
    preloaderYoinked = true;
}
