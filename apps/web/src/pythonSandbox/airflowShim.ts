/**
 * A pure-Python study shim for the Apache Airflow authoring surface.
 *
 * This is deliberately **not** Apache Airflow. It is a tiny, dependency-free
 * stand-in that implements the parts of the DAG-authoring API used by study
 * exercises: `DAG`, the `@dag`/`@task` decorators, `BashOperator`,
 * `PythonOperator`, `EmptyOperator`, `TaskGroup`, and `>>`/`<<` dependencies.
 * It schedules nothing, has no metadata database, web server, or executor, and
 * makes no network calls, so it runs in the sandbox like the standard library.
 *
 * Real Apache Airflow cannot run in Pyodide: it is an application, and the
 * pinned distribution does not ship it (see `docs/14-security-privacy.md`).
 * Because this shim is a sandbox built-in, content imports `airflow` but does
 * **not** declare it in `packages`.
 *
 * The worker installs the module before every run. The context stacks are
 * re-created on every execution, so a leaked `with DAG(...)` from one program
 * can never affect the next.
 */
export const AIRFLOW_SHIM = String.raw`
# ---- Apache Airflow study shim -------------------------------------------
# A tiny, dependency-free stand-in for the DAG-authoring API. It schedules
# nothing and makes no network calls. It is not Apache Airflow.
import sys as _al_sys
import types as _al_types

_AL_DAG_STACK = []
_AL_TASK_GROUP_STACK = []


def _al_install_airflow_shim():
    if "airflow" in _al_sys.modules:
        return

    def _al_current_dag():
        return _AL_DAG_STACK[-1] if _AL_DAG_STACK else None

    def _al_current_task_group():
        return _AL_TASK_GROUP_STACK[-1] if _AL_TASK_GROUP_STACK else None

    class _Task:
        """Minimal task node: a stable id plus dependency links."""

        def __init__(self, task_id, dag=None, task_group=None):
            self.task_id = task_id
            self.dag = dag
            self.task_group = task_group
            self.downstream_task_ids = set()
            self.upstream_task_ids = set()

        def set_downstream(self, other):
            _al_link(self, other)
            return self

        def set_upstream(self, other):
            _al_link(other, self)
            return self

        def __rshift__(self, other):
            _al_link(self, other)
            return other

        def __lshift__(self, other):
            _al_link(other, self)
            return other

        # Support "[a, b] >> c" and "c << [a, b]", where the list is the
        # left/right operand and this task is on the other side.
        def __rrshift__(self, other):
            _al_link(other, self)
            return self

        def __rlshift__(self, other):
            _al_link(self, other)
            return self

        def __repr__(self):
            return "<Task %s>" % self.task_id

    def _al_tasks(value):
        if isinstance(value, (list, tuple, set)):
            found = []
            for item in value:
                found.extend(_al_tasks(item))
            return found
        return [value]

    def _al_link(upstream, downstream):
        for up in _al_tasks(upstream):
            for down in _al_tasks(downstream):
                if not isinstance(up, _Task) or not isinstance(down, _Task):
                    raise TypeError("only tasks can be chained with >> or <<")
                up.downstream_task_ids.add(down.task_id)
                down.upstream_task_ids.add(up.task_id)

    class BaseOperator(_Task):
        """Base class for the operator shims below."""

        def __init__(self, task_id=None, dag=None, task_group=None, **kwargs):
            if not task_id:
                raise ValueError("task_id is required")
            super().__init__(task_id, dag=dag, task_group=task_group)
            for key, value in kwargs.items():
                setattr(self, key, value)
            _al_attach_task(self, dag, task_group)

    class BashOperator(BaseOperator):
        def __init__(self, *, bash_command=None, **kwargs):
            self.bash_command = bash_command
            super().__init__(**kwargs)

    class PythonOperator(BaseOperator):
        def __init__(self, *, python_callable=None, **kwargs):
            self.python_callable = python_callable
            super().__init__(**kwargs)

    class EmptyOperator(BaseOperator):
        pass

    DummyOperator = EmptyOperator

    class TaskGroup:
        """Grouping context; records its tasks, matching the authoring API."""

        def __init__(self, group_id=None, **kwargs):
            if not group_id:
                raise ValueError("group_id is required")
            self.group_id = group_id
            self.children = []
            for key, value in kwargs.items():
                setattr(self, key, value)

        def __enter__(self):
            _AL_TASK_GROUP_STACK.append(self)
            return self

        def __exit__(self, exc_type, exc, tb):
            _AL_TASK_GROUP_STACK.pop()
            return False

    def _al_attach_task(task, dag, task_group):
        group = task_group if task_group is not None else _al_current_task_group()
        if group is not None:
            task.task_group = group
            group.children.append(task)
        owner = dag if dag is not None else _al_current_dag()
        if owner is not None:
            owner.add_task(task)
        return task

    class DAG:
        """A DAG context that collects tasks in creation order."""

        def __init__(
            self,
            dag_id=None,
            schedule=None,
            start_date=None,
            catchup=False,
            tags=None,
            **kwargs
        ):
            if not dag_id:
                raise ValueError("dag_id is required")
            self.dag_id = dag_id
            self.schedule = schedule
            # Legacy alias still common in existing tutorials.
            self.schedule_interval = schedule
            self.start_date = start_date
            self.catchup = catchup
            self.tags = list(tags or [])
            self.tasks = []
            self._task_by_id = {}
            for key, value in kwargs.items():
                setattr(self, key, value)

        def __enter__(self):
            _AL_DAG_STACK.append(self)
            return self

        def __exit__(self, exc_type, exc, tb):
            _AL_DAG_STACK.pop()
            return False

        def add_task(self, task):
            if task.task_id in self._task_by_id:
                raise ValueError("duplicate task_id %r" % task.task_id)
            task.dag = self
            self._task_by_id[task.task_id] = task
            self.tasks.append(task)
            return task

        def get_task(self, task_id):
            return self._task_by_id.get(task_id)

        @property
        def task_ids(self):
            return [task.task_id for task in self.tasks]

        def dependencies(self):
            """JSON-friendly map of task id to sorted downstream ids."""
            return {
                task.task_id: sorted(task.downstream_task_ids)
                for task in self.tasks
            }

        def topological_sort(self):
            """Task ids in a deterministic topological order."""
            position = {}
            for index, task in enumerate(self.tasks):
                position[task.task_id] = index
            known = set(position)
            downstream = {}
            indegree = {}
            for task in self.tasks:
                downstream[task.task_id] = []
                indegree[task.task_id] = 0
            for task in self.tasks:
                for down in task.downstream_task_ids:
                    if down in known:
                        downstream[task.task_id].append(down)
                for up in task.upstream_task_ids:
                    if up in known:
                        indegree[task.task_id] += 1
            order = []
            remaining = set(position)
            while remaining:
                ready = [
                    task_id for task_id in remaining if indegree[task_id] == 0
                ]
                if not ready:
                    raise ValueError("cycle detected in DAG %r" % self.dag_id)
                ready.sort(key=lambda task_id: position[task_id])
                current = ready[0]
                order.append(current)
                remaining.discard(current)
                for down in downstream[current]:
                    indegree[down] -= 1
            return order

    class _DecoratedTask:
        def __init__(self, func, task_id=None):
            self.func = func
            self.task_id = task_id or func.__name__
            self.__name__ = getattr(func, "__name__", "task")
            self.__doc__ = getattr(func, "__doc__", None)

        def __call__(self, *args, **kwargs):
            task = _Task(self.task_id)
            task.call_args = args
            task.call_kwargs = kwargs
            _al_attach_task(task, None, None)
            return task

    def task(func=None, *, task_id=None):
        def wrap(f):
            return _DecoratedTask(f, task_id=task_id)

        if func is not None:
            return wrap(func)
        return wrap

    class _DecoratedDag:
        def __init__(
            self,
            func,
            dag_id=None,
            schedule=None,
            start_date=None,
            catchup=False,
            tags=None,
            **kwargs
        ):
            self.func = func
            self.dag_id = dag_id or func.__name__
            self.schedule = schedule
            self.start_date = start_date
            self.catchup = catchup
            self.tags = tags
            self.kwargs = kwargs
            self.__name__ = getattr(func, "__name__", "dag")
            self.__doc__ = getattr(func, "__doc__", None)

        def __call__(self, *args, **kwargs):
            dag = DAG(
                self.dag_id,
                schedule=self.schedule,
                start_date=self.start_date,
                catchup=self.catchup,
                tags=self.tags,
                **self.kwargs
            )
            with dag:
                self.func(*args, **kwargs)
            return dag

    def dag(
        func=None,
        *,
        dag_id=None,
        schedule=None,
        start_date=None,
        catchup=False,
        tags=None,
        **kwargs
    ):
        def wrap(f):
            return _DecoratedDag(
                f,
                dag_id=dag_id,
                schedule=schedule,
                start_date=start_date,
                catchup=catchup,
                tags=tags,
                **kwargs
            )

        if func is not None:
            return wrap(func)
        return wrap

    airflow = _al_types.ModuleType("airflow")
    operators = _al_types.ModuleType("airflow.operators")
    bash = _al_types.ModuleType("airflow.operators.bash")
    python_operators = _al_types.ModuleType("airflow.operators.python")
    empty = _al_types.ModuleType("airflow.operators.empty")
    decorators = _al_types.ModuleType("airflow.decorators")
    utils = _al_types.ModuleType("airflow.utils")
    task_group = _al_types.ModuleType("airflow.utils.task_group")
    models = _al_types.ModuleType("airflow.models")
    models_dag = _al_types.ModuleType("airflow.models.dag")

    airflow.DAG = DAG
    airflow.BaseOperator = BaseOperator
    airflow.__version__ = "study-shim-1"
    airflow.__study_shim__ = True

    bash.BashOperator = BashOperator
    python_operators.PythonOperator = PythonOperator
    empty.EmptyOperator = EmptyOperator
    empty.DummyOperator = DummyOperator
    decorators.dag = dag
    decorators.task = task
    task_group.TaskGroup = TaskGroup
    models.DAG = DAG
    models_dag.DAG = DAG

    operators.bash = bash
    operators.python = python_operators
    operators.empty = empty
    utils.task_group = task_group
    airflow.operators = operators
    airflow.decorators = decorators
    airflow.utils = utils
    airflow.models = models
    airflow.__all__ = [
        "DAG",
        "BaseOperator",
        "decorators",
        "models",
        "operators",
        "utils",
    ]

    _al_sys.modules.update(
        {
            "airflow": airflow,
            "airflow.operators": operators,
            "airflow.operators.bash": bash,
            "airflow.operators.python": python_operators,
            "airflow.operators.empty": empty,
            "airflow.decorators": decorators,
            "airflow.utils": utils,
            "airflow.utils.task_group": task_group,
            "airflow.models": models,
            "airflow.models.dag": models_dag,
        }
    )


if "_AL_AIRFLOW_SHIM_READY" not in globals():
    _al_install_airflow_shim()
    _AL_AIRFLOW_SHIM_READY = True
`;
