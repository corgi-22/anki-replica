/**
 * gestures.js - 卡片觸控拖曳手勢與滑動評分系統
 * 職責分離架構：
 * 1. 本模組僅專注處理外層容器的水平拖曳與滑動評分 (Swipe Left/Right)
 * 2. 翻牌動作 (Tap to Flip) 100% 交由瀏覽器原生的 click 觸控事件處理，兩者互不干擾！
 */

export function attachCardGestures(dragElement, options = {}) {
  const { onSwipeLeft, onSwipeRight } = options;

  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let isDragging = false;
  let hasMoved = false;

  const SWIPE_THRESHOLD = 80; // 滑動觸發門檻 (px)

  const badgeAgain = dragElement.querySelector('.badge-again');
  const badgeGood = dragElement.querySelector('.badge-good');

  function setTransform(x, y, animated = false) {
    if (animated) {
      dragElement.style.transition = 'transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.35s ease';
    } else {
      dragElement.style.transition = 'none';
    }

    const rotation = (x / 20).toFixed(2);
    dragElement.style.transform = `translate3d(${x}px, ${y * 0.2}px, 0) rotate(${rotation}deg)`;

    // 更新滑動標籤透明度
    if (badgeAgain && badgeGood) {
      if (x < -15) {
        badgeAgain.style.opacity = Math.min(1, Math.abs(x) / SWIPE_THRESHOLD);
        badgeGood.style.opacity = 0;
      } else if (x > 15) {
        badgeGood.style.opacity = Math.min(1, x / SWIPE_THRESHOLD);
        badgeAgain.style.opacity = 0;
      } else {
        badgeAgain.style.opacity = 0;
        badgeGood.style.opacity = 0;
      }
    }
  }

  function handleStart(clientX, clientY) {
    startX = clientX;
    startY = clientY;
    currentX = 0;
    currentY = 0;
    isDragging = true;
    hasMoved = false;
  }

  function handleMove(clientX, clientY) {
    if (!isDragging) return;
    const deltaX = clientX - startX;
    const deltaY = clientY - startY;

    // 若位移大於 8px，標記為拖曳，避免與純點擊 (Tap) 衝突
    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
      hasMoved = true;
    }

    if (hasMoved) {
      currentX = deltaX;
      currentY = deltaY;
      setTransform(currentX, currentY, false);
    }
  }

  function handleEnd() {
    if (!isDragging) return;
    isDragging = false;

    // 若沒有實際位移，純點擊交給瀏覽器原生 click 事件處理
    if (!hasMoved || Math.hypot(currentX, currentY) < 10) {
      setTransform(0, 0, true);
      return;
    }

    // 判斷滑動評分
    if (currentX < -SWIPE_THRESHOLD) {
      // 成功左滑 -> 重來
      setTransform(-window.innerWidth * 1.3, 0, true);
      dragElement.style.opacity = '0';
      setTimeout(() => {
        if (onSwipeLeft) onSwipeLeft();
      }, 250);
    } else if (currentX > SWIPE_THRESHOLD) {
      // 成功右滑 -> 良好
      setTransform(window.innerWidth * 1.3, 0, true);
      dragElement.style.opacity = '0';
      setTimeout(() => {
        if (onSwipeRight) onSwipeRight();
      }, 250);
    } else {
      // 未達門檻，彈回原位
      setTransform(0, 0, true);
      if (badgeAgain) badgeAgain.style.opacity = 0;
      if (badgeGood) badgeGood.style.opacity = 0;
    }

    // 稍微延遲重設 hasMoved，避免拖曳放開時誤觸發 click 事件
    setTimeout(() => {
      hasMoved = false;
    }, 100);
  }

  // 阻止拖曳後的幽靈 click
  dragElement.addEventListener('click', (e) => {
    if (hasMoved) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  // Touch 事件 (手機)
  dragElement.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    handleStart(touch.clientX, touch.clientY);
  }, { passive: true });

  dragElement.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    handleMove(touch.clientX, touch.clientY);
  }, { passive: true });

  dragElement.addEventListener('touchend', () => {
    handleEnd();
  }, { passive: true });

  // Mouse 事件 (電腦瀏覽器)
  dragElement.addEventListener('mousedown', (e) => {
    handleStart(e.clientX, e.clientY);

    const onMouseMove = (moveEvent) => {
      handleMove(moveEvent.clientX, moveEvent.clientY);
    };

    const onMouseUp = () => {
      handleEnd();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}
