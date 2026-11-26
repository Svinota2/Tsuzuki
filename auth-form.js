import { api } from './cloud-api.js';

export function mountAuth(root, { onLogin, notify, initial = 'login', inputClass = '', buttonClass = '' }) {
  const form = document.createElement('form');
  form.className = 'tsuzuki-auth';
  root.replaceChildren(form);
  let login = '';

  function field(label, properties) {
    const wrapper = document.createElement('label');
    const input = Object.assign(document.createElement('input'), { required: true, className: inputClass, ...properties });
    wrapper.append(label, input);
    form.append(wrapper);
    return input;
  }

  function button(label, type) {
    const node = Object.assign(document.createElement('button'), { type, className: buttonClass, textContent: label });
    form.append(node);
    return node;
  }

  function draw(mode) {
    form.replaceChildren();
    const registering = mode === 'register';
    const name = field('Логин', { value: login, autocomplete: 'username', autocapitalize: 'none', spellcheck: false,
      minLength: 3, maxLength: 32, title: 'Латинские буквы, цифры, дефис или подчёркивание' });
    if (registering) {
      const hint=document.createElement('small');
      hint.textContent='От 3 до 32 символов. Латинские буквы, цифры, дефис и подчёркивание. Восстановления по почте пока нет.';
      form.append(hint);
    }
    const password = field('Пароль', { type: 'password', autocomplete: registering ? 'new-password' : 'current-password',
      minLength: registering ? 10 : 1, maxLength: 72 });
    const repeated = registering && field('Повтори пароль', { type: 'password', autocomplete: 'new-password', minLength: 10, maxLength: 72 });
    button(registering ? 'Создать аккаунт' : 'Войти', 'submit');
    const toggle = button(registering ? 'У меня уже есть аккаунт' : 'Создать аккаунт', 'button');
    toggle.onclick = () => { login = name.value; notify(''); draw(registering ? 'login' : 'register'); form.querySelector('input').focus(); };
    form.onsubmit = async event => {
      event.preventDefault();
      notify('');
      const controls = [...form.elements];
      controls.forEach(node => { node.disabled = true; });
      try {
        if (repeated && repeated.value !== password.value) throw Error('Пароли не совпадают.');
        if (registering && new TextEncoder().encode(password.value).length > 72) throw Error('Выбери пароль покороче.');
        const result = await api(mode, 'POST', { login: name.value, password: password.value });
        form.reset();
        await onLogin(result.login);
      } catch (error) {
        notify(error.message);
      } finally {
        controls.forEach(node => { node.disabled = false; });
      }
    };
  }
  draw(initial);
}
