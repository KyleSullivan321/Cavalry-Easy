# Easy - custom easing curves for Cavalry

A curve editor panel for [Cavalry](https://cavalry.studio): shape a cubic-bezier ease, save it
as a preset, and apply it to the selected keyframes in one click. Works on Windows and macOS.

## Install

1. In Cavalry: **Help > Show Scripts Folder**.
2. Copy the `Easy` folder from this repo into that Scripts folder, so you end up with `<Scripts>/Easy/easy.js`.
3. In Cavalry: **Window > Scripts > Easy > easy**.

## Use

- **Create a curve** - drag the two handles, or type exact values (X1, Y1, X2, Y2, like CSS `cubic-bezier`). *Constrain straight* locks a drag to one axis.
- **Apply** - select keyframes in the timeline (not just a layer), then click **Apply**. The curve is applied to the segment leaving each selected keyframe, across all selected channels.
- **Presets** - click a thumbnail to load it. *Save preset* stores your curve (persisted between sessions in `<Scripts>/Easy/presets.json`); right-click a preset to delete it; *Load default presets* restores the built-ins (Accelerate, Decelerate, Super Smooth, Linear, Smooth, Ease In/Out, Quad, Cubic, Quart, Expo, Back, ...).
- Overshoot/anticipation curves (handles above 1 or below 0) are supported.

## Troubleshooting

- **Apply does nothing** - make sure *keyframes* are selected.
- **Panel missing from the menu** - check the file is at `<Scripts>/Easy/easy.js` and reopen via **Window > Scripts > Easy > easy**.
- **Laggy dragging** - that's Cavalry's mouse-event timing, not the curve math; use the numeric fields for exact values.

## License

[MIT](LICENSE) (c) Kyle Sullivan.
